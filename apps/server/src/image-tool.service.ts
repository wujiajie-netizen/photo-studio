import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { Subject } from 'rxjs';
import type { AgentModelProvider } from '@photo-studio/ai-provider';
import { validateImageToolInput, type EditorLayer, type ImageToolInput, type ImageToolTask, type ProductImageResult } from '@photo-studio/shared';
import { AGENT_MODEL_PROVIDER } from './agent.service';
import { StorageService } from './storage.service';
import { ProductImageService } from './product-image.service';

const columns = 'id, session_id AS sessionId, result_id AS resultId, input, status, progress, output_result_ids AS outputResultIds, output_layers AS outputLayers, error, created_at AS createdAt, updated_at AS updatedAt';
const names: Record<ImageToolInput['operation'], string> = { edit: 'AI改图', erase: '无痕消除', 'replace-text': '无痕改字', cutout: '抠图', upscale: 'AI超清', expand: 'AI扩图', 'split-layers': '拆分图层', 'recognize-text': '编辑文字' };
type TextRegion = { text: string; x: number; y: number; width: number; height: number; color: string; align: 'left' | 'center' | 'right' };
type ImageRegion = { name: string; x: number; y: number; width: number; height: number };

@Injectable()
export class ImageToolService {
  readonly changes = new Subject<ImageToolTask>();
  private readonly queue: ImageToolTask[] = [];
  private running: { id: string; signal: AbortController } | null = null;
  private stopped = false;
  private work: Promise<void> = Promise.resolve();
  constructor(@Inject(StorageService) private readonly storage: StorageService, @Inject(ProductImageService) private readonly images: ProductImageService, @Inject(AGENT_MODEL_PROVIDER) private readonly provider: AgentModelProvider) {
    storage.beforeClose.push(() => this.close());
    storage.database.prepare("UPDATE image_tool_tasks SET status = 'failed', error = ?, updated_at = ? WHERE status IN ('queued', 'running')").run('服务已重新启动，图片处理已中断，请重试。', new Date().toISOString());
  }
  task(id: string): ImageToolTask {
    const row = this.storage.database.prepare(`SELECT ${columns} FROM image_tool_tasks WHERE id = ?`).get(id);
    if (!row) throw new NotFoundException('图片处理任务不存在。');
    return { ...row, input: JSON.parse(row.input as string), outputResultIds: JSON.parse(row.outputResultIds as string), outputLayers: JSON.parse(row.outputLayers as string) } as unknown as ImageToolTask;
  }
  list(sessionId: string): ImageToolTask[] {
    if (!this.storage.database.prepare('SELECT id FROM agent_sessions WHERE id = ?').get(sessionId)) throw new NotFoundException('会话不存在。');
    return this.storage.database.prepare('SELECT id FROM image_tool_tasks WHERE session_id = ? ORDER BY created_at DESC, rowid DESC').all(sessionId).map(row => this.task(row.id as string));
  }
  submit(value: unknown): ImageToolTask {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 3) throw new BadRequestException('图片处理提交字段无效。');
    const body = value as { sessionId: string; resultId: string; input: ImageToolInput }; let input: ImageToolInput;
    if (![body.sessionId, body.resultId].every(id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) throw new BadRequestException('会话或作品编号无效。');
    try { input = validateImageToolInput(body.input); } catch (error) { throw new BadRequestException((error as Error).message); }
    this.list(body.sessionId); this.images.resultFile(body.resultId);
    /* 作品必须来自本会话的执行或工具结果，避免错误会话接收处理结果。 */
    const executions = this.storage.database.prepare('SELECT steps FROM agent_executions WHERE session_id = ?').all(body.sessionId);
    const result = this.images.result(body.resultId);
    if (!executions.some(row => (JSON.parse(row.steps as string) as { taskId: string | null }[]).some(step => step.taskId === result.taskId)) && !this.storage.database.prepare('SELECT id FROM image_tool_tasks WHERE id = ? AND session_id = ?').get(result.taskId, body.sessionId)) throw new BadRequestException('请选择当前会话中的作品。');
    const asset = this.images.asset(input.sourceAssetId); this.images.assetFile(asset.id);
    if ('maskAssetId' in input && input.maskAssetId !== null) {
      const mask = this.images.asset(input.maskAssetId); this.images.assetFile(mask.id);
      if (mask.width !== asset.width || mask.height !== asset.height) throw new BadRequestException('涂抹区域与处理图片尺寸必须一致。');
    }
    if (input.operation === 'expand' && (input.x + asset.width > input.width || input.y + asset.height > input.height)) throw new BadRequestException('扩图画幅必须完整包含原图片。');
    if (input.operation === 'upscale' && (asset.width * input.scale > 16384 || asset.height * input.scale > 16384 || asset.width * asset.height * input.scale ** 2 > 16_000_000)) throw new BadRequestException('超清结果超过 1600 万像素，请降低倍数或先裁剪图片。');
    if (this.stopped || this.queue.length >= 10) throw new ConflictException('图片处理队列繁忙，请稍后重试。');
    const now = new Date().toISOString();
    const task: ImageToolTask = { id: randomUUID(), sessionId: body.sessionId, resultId: body.resultId, input, status: 'queued', progress: 0, outputResultIds: [], outputLayers: [], error: null, createdAt: now, updatedAt: now };
    this.storage.database.prepare('INSERT INTO image_tool_tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(task.id, task.sessionId, task.resultId, JSON.stringify(input), task.status, 0, '[]', '[]', null, now, now);
    this.queue.push(task); this.changes.next(task); queueMicrotask(() => this.pump()); return task;
  }
  cancel(id: string): ImageToolTask {
    const task = this.task(id); if (!['queued', 'running'].includes(task.status)) return task;
    const index = this.queue.findIndex(item => item.id === id); if (index >= 0) this.queue.splice(index, 1);
    if (this.running?.id === id) { this.running.signal.abort(); this.provider.cancel(id).catch(() => {}); }
    return this.update(id, 'cancelled', task.progress);
  }
  retry(id: string): ImageToolTask {
    const task = this.task(id); if (!['failed', 'cancelled'].includes(task.status)) throw new ConflictException('只有失败或停止的任务可以重试。');
    return this.submit({ sessionId: task.sessionId, resultId: task.resultId, input: task.input });
  }
  private update(id: string, status: ImageToolTask['status'], progress: number, error: string | null = null): ImageToolTask {
    this.storage.database.prepare('UPDATE image_tool_tasks SET status = ?, progress = ?, error = ?, updated_at = ? WHERE id = ?').run(status, progress, error, new Date().toISOString(), id);
    const task = this.task(id); this.changes.next(task); return task;
  }
  private pump() {
    if (this.stopped || this.running) return;
    const task = this.queue.shift(); if (!task) return;
    const signal = new AbortController(); this.running = { id: task.id, signal }; this.update(task.id, 'running', 5);
    const check = () => { if (this.stopped || signal.signal.aborted) throw new Error('图片处理已停止。'); };
    const timer = setTimeout(() => { signal.abort(); this.provider.cancel(task.id).catch(() => {}); if (!this.stopped && this.task(task.id).status === 'running') this.update(task.id, 'failed', this.task(task.id).progress, '图片处理超时，请检查 Codex 后重试。'); }, 20 * 60 * 1000);
    const directory = resolve(this.storage.dataDirectory, 'runs', `image-tool-${task.id}`);
    let savedPaths: string[] = [];
    /* 独立目录执行；全部输出校验并写好后一起落库，取消和失败不能产生半份拆层文档。 */
    this.work = mkdir(directory, { recursive: true }).then(() => writeFile(resolve(directory, 'input.json'), JSON.stringify(task.input), 'utf8'))
      .then(() => readFile(this.images.assetFile(task.input.sourceAssetId))).then(source => { check(); return this.render(task, source, signal.signal); })
      .then(output => {
        check(); this.update(task.id, 'running', 90);
        const projectId = this.images.result(task.resultId).projectId;
        const results: ProductImageResult[] = output.images.map((image, index) => ({ id: randomUUID(), taskId: task.id, name: `${names[task.input.operation]}${index ? `_${image.name}` : ''}.png`, width: image.width, height: image.height, createdAt: new Date().toISOString(), projectId }));
        savedPaths = results.map(result => resolve(this.storage.dataDirectory, 'generated', `${result.id}.png`));
        return Promise.all(output.images.map((image, index) => writeFile(savedPaths[index], image.data))).then(() => {
          check(); const layers: EditorLayer[] = results.map((result, index) => ({ id: randomUUID(), type: 'image', name: output.images[index].name, resultId: result.id, x: 0, y: 0, width: result.width, height: result.height, rotation: 0, opacity: 1, visible: true, locked: false }));
          for (const region of output.text) layers.push({ id: randomUUID(), type: 'text', name: region.text.slice(0, 40), text: region.text, x: region.x, y: region.y, width: region.width, height: region.height, align: region.align, fontSize: Math.max(8, Math.min(300, Math.round(region.height * .85))), fontFamily: 'Microsoft YaHei', fill: region.color, rotation: 0, opacity: 1, visible: true, locked: false });
          const database = this.storage.database; database.exec('BEGIN');
          try {
            for (const [index, result] of results.entries()) {
              database.prepare('INSERT INTO image_tool_results VALUES (?, ?, ?, ?, ?, ?, ?)').run(result.id, result.taskId, result.name, result.width, result.height, result.createdAt, projectId);
              const contentLayers = index === 0 ? layers : [layers[index]];
              database.prepare('INSERT INTO editor_documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), result.id, projectId, result.name, result.width, result.height, task.input.operation === 'cutout' || index > 0 ? 'transparent' : '#ffffff', JSON.stringify(contentLayers), 0, result.createdAt, result.createdAt);
            }
            database.prepare('UPDATE image_tool_tasks SET output_result_ids = ?, output_layers = ? WHERE id = ?').run(JSON.stringify(results.map(result => result.id)), JSON.stringify(task.input.operation === 'split-layers' || task.input.operation === 'recognize-text' ? layers : []), task.id);
            if (projectId) database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), projectId);
            database.exec('COMMIT');
          } catch (error) { database.exec('ROLLBACK'); throw error; }
          savedPaths = []; this.update(task.id, 'succeeded', 100);
        });
      }).catch((error: Error) => {
        if (!signal.signal.aborted && !this.stopped) this.update(task.id, 'failed', this.task(task.id).progress, error.message || '图片处理失败，请重试。');
        return Promise.all(savedPaths.map(path => unlink(path).catch(() => {}))).then(() => {});
      }).finally(() => { clearTimeout(timer); this.running = null; if (!this.stopped) this.pump(); });
  }
  private generate(id: string, source: Buffer, prompt: string, width: number, height: number, signal: AbortSignal): Promise<Buffer> {
    return this.provider.generateImage(id, source, prompt, signal).then(data => {
      if (signal.aborted) throw new Error('图片处理已停止。');
      return sharp(data, { failOn: 'warning', limitInputPixels: 16_000_000 }).metadata().then(info => {
        if (info.format !== 'png' || (info.pages ?? 1) !== 1) throw new Error('图片处理返回了无效的图片。');
        return sharp(data).resize(width, height, { fit: 'fill' }).ensureAlpha().png().toBuffer();
      });
    });
  }
  private masked(task: ImageToolTask, source: Buffer, mask: Buffer, prompt: string, signal: AbortSignal, preserveOutside = true): Promise<Buffer> {
    const asset = this.images.asset(task.input.sourceAssetId); let alpha: Buffer;
    return sharp(mask).removeAlpha().greyscale().raw().toBuffer().then(data => {
      if (!data.some(value => value > 0)) throw new Error('请先涂抹需要处理的区域。');
      alpha = data;
      return sharp({ create: { width: asset.width, height: asset.height, channels: 3, background: '#ec4899' } }).joinChannel(Buffer.from(data.map(value => Math.round(value * .42))), { raw: { width: asset.width, height: asset.height, channels: 1 } }).png().toBuffer();
    }).then(overlay => sharp(source).composite([{ input: overlay }]).png().toBuffer())
      .then(guide => this.generate(task.id, guide, `${prompt} The translucent pink overlay marks the editable region. Remove the pink marking in the final image; preserve all unmarked content. Match the original ${asset.width}x${asset.height} composition.`, asset.width, asset.height, signal))
      .then(data => {
        /* 拆层背景整体重建，避免矩形拼接接缝；局部改图仍逐像素保留黑色区域。 */
        if (!preserveOutside) return data;
        return Promise.all([sharp(source).ensureAlpha().raw().toBuffer(), sharp(data).ensureAlpha().raw().toBuffer()]).then(([original, generated]) => {
          const output = Buffer.from(original);
          for (let index = 0; index < alpha.length; index++) for (let channel = 0; channel < 4; channel++) output[index * 4 + channel] = Math.round(original[index * 4 + channel] * (1 - alpha[index] / 255) + generated[index * 4 + channel] * alpha[index] / 255);
          return sharp(output, { raw: { width: asset.width, height: asset.height, channels: 4 } }).png().toBuffer();
        });
      });
  }
  private recognize(task: ImageToolTask, source: Buffer, signal: AbortSignal): Promise<TextRegion[]> {
    const asset = this.images.asset(task.input.sourceAssetId);
    const schema = { type: 'object', properties: { regions: { type: 'array', maxItems: 30, items: { type: 'object', properties: { text: { type: 'string' }, x: { type: 'integer' }, y: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' }, color: { type: 'string' }, align: { type: 'string', enum: ['left', 'center', 'right'] } }, required: ['text', 'x', 'y', 'width', 'height', 'color', 'align'], additionalProperties: false } } }, required: ['regions'], additionalProperties: false };
    const iterator = this.provider.run({ taskId: task.id, images: [source], schema, prompt: `Recognize only text actually visible in this ${asset.width}x${asset.height} image. Return each independent text line verbatim, bounding box in ORIGINAL pixel coordinates, foreground hex color and alignment. Do not invent any text. Empty regions if no text is visible.` })[Symbol.asyncIterator]();
    const consume = (): Promise<TextRegion[]> => iterator.next().then(event => {
      if (signal.aborted) throw new Error('文字识别已停止。');
      if (event.done) throw new Error('文字识别没有返回结果。');
      if (event.value.type === 'failed') throw new Error(event.value.message);
      if (event.value.type === 'cancelled') throw new Error('文字识别已停止。');
      if (event.value.type !== 'completed') return consume();
      const result = event.value.result as { regions: TextRegion[] };
      if (!result || !Array.isArray(result.regions) || result.regions.length > 30 || result.regions.some(region => !region || typeof region.text !== 'string' || !region.text.trim() || region.text.length > 2000 || ![region.x, region.y, region.width, region.height].every(Number.isInteger) || region.x < 0 || region.y < 0 || region.width < 1 || region.height < 1 || region.x + region.width > asset.width || region.y + region.height > asset.height || !/^#[0-9a-f]{6}$/i.test(region.color) || !['left', 'center', 'right'].includes(region.align))) throw new Error('文字识别结果坐标或内容无效，请重试。');
      if (!result.regions.length && task.input.operation !== 'split-layers') throw new Error('图片中未识别到文字，可以使用添加文字。');
      return result.regions;
    });
    return consume().finally(() => iterator.return?.().then(() => {}));
  }
  private removeText(task: ImageToolTask, source: Buffer, text: TextRegion[], signal: AbortSignal): Promise<Buffer> {
    if (!text.length) return Promise.resolve(source);
    const { width, height } = this.images.asset(task.input.sourceAssetId); const mask = Buffer.alloc(width * height);
    /* 识别框留少量边距覆盖抗锯齿和字形外沿，避免重建背景后残留笔画。 */
    for (const region of text) { const padding = Math.max(4, Math.min(16, Math.ceil(region.height * .12))); for (let row = Math.max(0, region.y - padding); row < Math.min(height, region.y + region.height + padding); row++) mask.fill(255, row * width + Math.max(0, region.x - padding), row * width + Math.min(width, region.x + region.width + padding)); }
    return sharp(mask, { raw: { width, height, channels: 1 } }).png().toBuffer().then(data => this.masked(task, source, data, 'Remove ONLY the marked printed text and reconstruct its original background naturally. Leave logos and objects intact. Do not add any text.', signal));
  }
  private objects(task: ImageToolTask, source: Buffer, signal: AbortSignal): Promise<ImageRegion[]> {
    const { width, height } = this.images.asset(task.input.sourceAssetId);
    const schema = { type: 'object', properties: { objects: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', properties: { name: { type: 'string' }, x: { type: 'integer' }, y: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' } }, required: ['name', 'x', 'y', 'width', 'height'], additionalProperties: false } } }, required: ['objects'], additionalProperties: false };
    const iterator = this.provider.run({ taskId: task.id, images: [source], schema, prompt: `Separate the actual foreground product and independent decorative elements in this ${width}x${height} image into editable image layers. Return ORIGINAL pixel bounding boxes and short Chinese names. The first object is the main product; group scattered related small decorations as one separate object. Include only clearly visible foreground elements, exclude text, flat backgrounds, gradients, shadows, and objects belonging to the background scene. No invented objects, maximum 8 objects.` })[Symbol.asyncIterator]();
    const consume = (): Promise<ImageRegion[]> => iterator.next().then(event => {
      if (signal.aborted) throw new Error('图层分析已停止。');
      if (event.done) throw new Error('图层分析没有返回结果。');
      if (event.value.type === 'failed') throw new Error(event.value.message);
      if (event.value.type === 'cancelled') throw new Error('图层分析已停止。');
      if (event.value.type !== 'completed') return consume();
      const value = event.value.result as { objects: ImageRegion[] };
      if (!value || Object.keys(value).length !== 1 || !Array.isArray(value.objects) || !value.objects.length || value.objects.length > 8 || value.objects.some(item => !item || Object.keys(item).length !== 5 || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 100 || ![item.x, item.y, item.width, item.height].every(Number.isInteger) || item.x < 0 || item.y < 0 || item.width < 1 || item.height < 1 || item.x + item.width > width || item.y + item.height > height)) throw new Error('图层分析返回了无效的元素范围，请重试。');
      return value.objects;
    });
    return consume().finally(() => iterator.return?.().then(() => {}));
  }
  private foreground(task: ImageToolTask, source: Buffer, signal: AbortSignal, region?: ImageRegion): Promise<Buffer> {
    const { width, height } = this.images.asset(task.input.sourceAssetId); const side = Math.max(width, height); const left = Math.floor((side - width) / 2); const top = Math.floor((side - height) / 2);
    const subject = region ? `ONLY the element named ${JSON.stringify(region.name)} in ORIGINAL box x=${region.x}, y=${region.y}, width=${region.width}, height=${region.height}. Exclude every other element including the main product unless it is the requested element.` : 'the main product or subject. Do not include loose foreground objects outside the main subject.';
    return sharp(source).extend({ left, right: side - width - left, top, bottom: side - height - top, background: '#000000' }).png().toBuffer()
      .then(square => this.generate(task.id, square, `Return a SQUARE ${side}x${side} grayscale segmentation matte of ${subject} The original photo is at x=${left}, y=${top}, width=${width}, height=${height}; the padded margins must be pure black. Pure white ONLY over the exact original element silhouette, pure black everywhere else, antialiased edges. Trace the original boundary exactly; do not redraw, move, resize, recenter or reinterpret the element. No colors, labels or other content.`, side, side, signal))
      .then(data => sharp(data).extract({ left, top, width, height }).removeAlpha().greyscale().raw().toBuffer()).then(alpha => {
        if (region) for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) if (column < region.x || row < region.y || column >= region.x + region.width || row >= region.y + region.height) alpha[row * width + column] = 0;
        if (!alpha.some(value => value > 200) || !alpha.some(value => value < 40)) throw new Error('未能识别出独立元素，请重试或先裁剪商品范围。');
        return sharp(source).ensureAlpha().raw().toBuffer().then(pixels => {
          for (let index = 0; index < alpha.length; index++) pixels[index * 4 + 3] = Math.round(pixels[index * 4 + 3] * alpha[index] / 255);
          return sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
        });
      });
  }
  private render(task: ImageToolTask, source: Buffer, signal: AbortSignal): Promise<{ images: { data: Buffer; width: number; height: number; name: string }[]; text: TextRegion[] }> {
    const input = task.input; const asset = this.images.asset(input.sourceAssetId); const width = asset.width; const height = asset.height;
    const single = (data: Buffer, wide = width, tall = height) => ({ images: [{ data, width: wide, height: tall, name: input.operation === 'cutout' ? '主体' : names[input.operation] }], text: [] as TextRegion[] });
    if (input.operation === 'edit' || input.operation === 'erase' || input.operation === 'replace-text') {
      const prompt = input.operation === 'edit' ? `Edit this image according to the following visual requirements: ${input.prompt}` : input.operation === 'erase' ? 'Remove the marked objects and naturally reconstruct the underlying scene. Do not replace them with other objects.' : `Replace the marked text with this exact text, preserving its style and perspective: ${input.text}`;
      return input.maskAssetId === null ? this.generate(task.id, source, prompt, width, height, signal).then(data => single(data)) : readFile(this.images.assetFile(input.maskAssetId)).then(mask => this.masked(task, source, mask, prompt, signal)).then(data => single(data));
    }
    if (input.operation === 'upscale') return this.generate(task.id, source, `Enhance this image to ${input.scale}x resolution. Recover realistic fine detail and reduce compression artifacts without altering any object, text, color or composition. Do not add content.`, width * input.scale, height * input.scale, signal).then(data => single(data, width * input.scale, height * input.scale));
    if (input.operation === 'expand') {
      return sharp({ create: { width: input.width, height: input.height, channels: 4, background: '#808080' } }).composite([{ input: source, left: input.x, top: input.y }]).png().toBuffer()
        .then(guide => this.generate(task.id, guide, `Outpaint the grey empty area around the original image located at x=${input.x}, y=${input.y}, size ${width}x${height}. Extend the existing scene naturally. Keep original content unchanged. Visual requirements: ${input.prompt}`, input.width, input.height, signal))
        .then(data => sharp(data).composite([{ input: source, left: input.x, top: input.y }]).png().toBuffer()).then(data => single(data, input.width, input.height));
    }
    if (input.operation === 'recognize-text') return this.recognize(task, source, signal).then(text => this.removeText(task, source, text, signal).then(data => ({ images: [{ data, width, height, name: '背景' }], text })));
    if (input.operation === 'split-layers') return this.recognize(task, source, signal).then(text => this.removeText(task, source, text, signal).then(clean => {
      /* 独立主体与装饰逐一提取；合并选区补全背景，重叠边缘不在多个图层重复叠加。 */
      return this.objects(task, clean, signal).then(objects => {
        const images: { data: Buffer; width: number; height: number; name: string }[] = []; const occupied = Buffer.alloc(width * height);
        return objects.reduce((pending, region) => pending.then(() => this.foreground(task, clean, signal, region)).then(data => sharp(data).ensureAlpha().raw().toBuffer()).then(pixels => {
          for (let index = 0; index < occupied.length; index++) { const alpha = Math.min(pixels[index * 4 + 3], 255 - occupied[index]); pixels[index * 4 + 3] = alpha; occupied[index] += alpha; }
          return sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer().then(data => { images.push({ data, width, height, name: region.name }); this.update(task.id, 'running', Math.round(20 + images.length / objects.length * 55)); });
        }), Promise.resolve()).then(() => {
          /* 背景补全覆盖元素包围框和接触阴影，避免主体隐藏后还露出轮廓或阴影残留。 */
          const backgroundMask = Buffer.alloc(width * height); const padding = Math.max(12, Math.min(48, Math.ceil(width * .03)));
          for (const region of objects) for (let row = Math.max(0, region.y - padding); row < Math.min(height, region.y + region.height + padding); row++) backgroundMask.fill(255, row * width + Math.max(0, region.x - padding), row * width + Math.min(width, region.x + region.width + padding));
          return sharp(backgroundMask, { raw: { width, height, channels: 1 } }).png().toBuffer();
        }).then(mask => this.masked(task, clean, mask, 'Remove ALL foreground products, decorations, object outlines and their contact shadows inside the marked area. Reconstruct only the empty original background surface and lighting behind them. Keep the same background color, perspective and illumination smoothly across the WHOLE image. No white silhouettes, bean outlines, replacement objects or text. Leave no trace of removed elements.', signal, false))
          .then(background => ({ images: [{ data: background, width, height, name: '背景' }, ...images], text }));
      });
    }));
    return this.foreground(task, source, signal).then(data => single(data));
  }
  private close(): Promise<void> {
    this.stopped = true; this.queue.length = 0; this.running?.signal.abort(); this.changes.complete();
    return (this.running ? this.provider.cancel(this.running.id).catch(() => {}) : Promise.resolve()).then(() => this.work);
  }
}
