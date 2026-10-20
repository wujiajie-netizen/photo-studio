import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { Subject } from 'rxjs';
import { LayerSegmentationError, type AgentModelProvider, type LocalImageOutput } from '@photo-studio/ai-provider';
import { validateImageToolInput, type EditorLayer, type ImageToolInput, type ImageToolTask, type ProductImageResult } from '@photo-studio/shared';
import { AGENT_MODEL_PROVIDER } from './agent.service';
import { StorageService } from './storage.service';
import { ProductImageService } from './product-image.service';

const columns = 'id, session_id AS sessionId, result_id AS resultId, input, status, progress, output_result_ids AS outputResultIds, output_layers AS outputLayers, error, created_at AS createdAt, updated_at AS updatedAt';
const names: Record<ImageToolInput['operation'], string> = { edit: 'AI改图', erase: '无痕消除', 'replace-text': '无痕改字', cutout: '抠图', upscale: 'AI超清', expand: 'AI扩图', 'split-layers': '拆分图层', 'recognize-text': '编辑文字' };
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
    if (!this.storage.database.prepare('SELECT id FROM agent_sessions WHERE id = ? AND deleted_at IS NULL').get(row.sessionId as string)) throw new NotFoundException('会话不存在。');
    return { ...row, input: JSON.parse(row.input as string), outputResultIds: JSON.parse(row.outputResultIds as string), outputLayers: JSON.parse(row.outputLayers as string) } as unknown as ImageToolTask;
  }
  list(sessionId: string): ImageToolTask[] {
    if (!this.storage.database.prepare('SELECT id FROM agent_sessions WHERE id = ? AND deleted_at IS NULL').get(sessionId)) throw new NotFoundException('会话不存在。');
    return this.storage.database.prepare('SELECT id FROM image_tool_tasks WHERE session_id = ? ORDER BY created_at DESC, rowid DESC').all(sessionId).map(row => this.task(row.id as string));
  }
  submit(value: unknown): ImageToolTask {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 3) throw new BadRequestException('图片处理提交字段无效。');
    const body = value as { sessionId: string; resultId: string; input: ImageToolInput }; let input: ImageToolInput;
    if (![body.sessionId, body.resultId].every(id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) throw new BadRequestException('会话或作品编号无效。');
    try { input = validateImageToolInput(body.input); } catch (error) { throw new BadRequestException((error as Error).message); }
    this.list(body.sessionId); this.images.resultFile(body.resultId);
    /* 作品必须来自本会话或关联项目，独立工具生成的项目作品也可在创作页继续处理。 */
    const executions = this.storage.database.prepare('SELECT steps FROM agent_executions WHERE session_id = ?').all(body.sessionId);
    const result = this.images.result(body.resultId);
    const project = result.projectId && this.storage.database.prepare('SELECT id FROM agent_sessions WHERE id = ? AND project_id = ? UNION SELECT id FROM agent_executions WHERE session_id = ? AND project_id = ?').get(body.sessionId, result.projectId, body.sessionId, result.projectId);
    if (!project && !executions.some(row => (JSON.parse(row.steps as string) as { taskId: string | null }[]).some(step => step.taskId === result.taskId)) && !this.storage.database.prepare('SELECT id FROM image_tool_tasks WHERE id = ? AND session_id = ?').get(result.taskId, body.sessionId)) throw new BadRequestException('请选择当前会话或关联项目中的作品。');
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
      .then(output => Promise.all(output.images.map(image => sharp(image.data, { failOn: 'warning', limitInputPixels: 16_000_000 }).metadata().then(info => {
        if (info.format !== 'png' || (info.pages ?? 1) !== 1 || info.width !== image.width || info.height !== image.height) throw new Error('图片处理结果格式或尺寸无效。');
      }))).then(() => output))
      .then(output => {
        check(); this.update(task.id, 'running', 90);
        const projectId = this.images.result(task.resultId).projectId;
        const results: ProductImageResult[] = output.images.map((image, index) => ({ id: randomUUID(), taskId: task.id, name: `${names[task.input.operation]}${index ? `_${image.name}` : ''}.png`, width: image.width, height: image.height, createdAt: new Date().toISOString(), projectId }));
        savedPaths = results.map(result => resolve(this.storage.dataDirectory, 'generated', `${result.id}.png`));
        return Promise.all(output.images.map((image, index) => writeFile(savedPaths[index], image.data))).then(() => {
          check(); const layers: EditorLayer[] = results.map((result, index) => ({ id: randomUUID(), type: 'image', name: output.images[index].name, resultId: result.id, x: 0, y: 0, width: result.width, height: result.height, rotation: 0, opacity: 1, visible: true, locked: false }));
          for (const region of output.text) layers.push({ ...region, id: randomUUID(), type: 'text', name: region.text.slice(0, 40), opacity: 1, visible: true, locked: false });
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
  private generate(id: string, source: Buffer, prompt: string, width: number, height: number, signal: AbortSignal, guide?: Buffer): Promise<Buffer> {
    return this.provider.generateImage(id, source, prompt, signal, guide).then(data => {
      if (signal.aborted) throw new Error('图片处理已停止。');
      return sharp(data, { failOn: 'warning', limitInputPixels: 16_000_000 }).metadata().then(info => {
        if (info.format !== 'png' || (info.pages ?? 1) !== 1) throw new Error('图片处理返回了无效的图片。');
        return sharp(data).resize(width, height, { fit: 'fill' }).ensureAlpha().png().toBuffer();
      });
    });
  }
  private masked(task: ImageToolTask, source: Buffer, mask: Buffer, prompt: string, signal: AbortSignal): Promise<Buffer> {
    const asset = this.images.asset(task.input.sourceAssetId); let alpha: Buffer;
    return sharp(mask).removeAlpha().greyscale().raw().toBuffer().then(data => {
      if (!data.some(value => value > 0)) throw new Error('请先涂抹需要处理的区域。');
      alpha = data;
      return sharp({ create: { width: asset.width, height: asset.height, channels: 3, background: '#ec4899' } }).joinChannel(Buffer.from(data.map(value => Math.round(value * .42))), { raw: { width: asset.width, height: asset.height, channels: 1 } }).png().toBuffer();
    }).then(overlay => sharp(source).composite([{ input: overlay }]).png().toBuffer())
      /* 原图提供真实字色和背景；第二张仅标记范围，避免把选区染色当成设计样式。 */
      .then(guide => this.generate(task.id, source, `${prompt} Image 1 is the untouched original and is the sole reference for colors, texture, text style and lighting. Image 2 is only a selection guide: its translucent pink overlay marks the editable region, not a desired color or background panel. Return one ${asset.width}x${asset.height} image matching image 1 exactly outside the selection. Inside it, match the original background continuously without a box, patch edge or pink tint. Do not reproduce the guide overlay.`, asset.width, asset.height, signal, guide))
      .then(data => {
        /* 局部改图逐像素保留黑色区域，模型输出只能影响用户涂抹的选区。 */
        return Promise.all([sharp(source).ensureAlpha().raw().toBuffer(), sharp(data).ensureAlpha().raw().toBuffer()]).then(([original, generated]) => {
          const output = Buffer.from(original);
          for (let index = 0; index < alpha.length; index++) for (let channel = 0; channel < 4; channel++) output[index * 4 + channel] = Math.round(original[index * 4 + channel] * (1 - alpha[index] / 255) + generated[index * 4 + channel] * alpha[index] / 255);
          return sharp(output, { raw: { width: asset.width, height: asset.height, channels: 4 } }).png().toBuffer();
        });
      });
  }
  private objects(task: ImageToolTask, source: Buffer, signal: AbortSignal, correction?: { objects: ImageRegion[]; name: string; message: string }): Promise<ImageRegion[]> {
    const { width, height } = this.images.asset(task.input.sourceAssetId);
    const schema = { type: 'object', properties: { objects: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', properties: { name: { type: 'string' }, x: { type: 'integer' }, y: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' } }, required: ['name', 'x', 'y', 'width', 'height'], additionalProperties: false } } }, required: ['objects'], additionalProperties: false };
    /* 原图用于判断物体；独立坐标参考图帮助定位，不把网格写入素材或分割输入。 */
    const step = Math.max(50, Math.round(Math.max(width, height) / 10 / 50) * 50);
    const lines: string[] = [];
    for (let x = 0; x < width; x += step) lines.push(`<path d="M${x} 0V${height}"/><text x="${x + 3}" y="16">x=${x}</text>`);
    for (let y = 0; y < height; y += step) lines.push(`<path d="M0 ${y}H${width}"/><text x="3" y="${y + 16}">y=${y}</text>`);
    if (correction) correction.objects.forEach((object, index) => lines.push(`<rect x="${object.x}" y="${object.y}" width="${object.width}" height="${object.height}" fill="none" stroke="#e23b50" stroke-width="3"/><text x="${object.x + 4}" y="${object.y + 16}" fill="#e23b50" stroke="white">#${index + 1}</text>`));
    const grid = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g fill="#ffffff" stroke="#1677ff" stroke-width="1" font-family="Arial" font-size="14">${lines.join('')}</g></svg>`);
    /* 小物体纠正时补充放大局部，所有标签仍使用原图坐标；仅用于分析，不改变分割源图。 */
    const details = correction ? correction.objects.map((object, index) => ({ object, index })).filter(({ object, index }) => index > 0 && Math.max(object.width, object.height) < Math.min(width, height) * .2).map(({ object, index }) => {
      const padding = Math.max(32, Math.max(object.width, object.height)); const left = Math.max(0, object.x - padding); const top = Math.max(0, object.y - padding);
      return { object, index, left, top, width: Math.min(width, object.x + object.width + padding) - left, height: Math.min(height, object.y + object.height + padding) - top };
    }) : [];
    return Promise.all([sharp(source).composite([{ input: grid }]).png().toBuffer(), ...details.map(detail => {
      const spacing = Math.max(10, Math.round(Math.max(detail.object.width, detail.object.height) / 4 / 10) * 10); const marks: string[] = [];
      for (let x = Math.ceil(detail.left / spacing) * spacing; x < detail.left + detail.width; x += spacing) marks.push(`<path d="M${x - detail.left} 0V${detail.height}"/><text x="${x - detail.left + 2}" y="11">${x}</text>`);
      for (let y = Math.ceil(detail.top / spacing) * spacing; y < detail.top + detail.height; y += spacing) marks.push(`<path d="M0 ${y - detail.top}H${detail.width}"/><text x="2" y="${y - detail.top + 11}">${y}</text>`);
      const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${detail.width}" height="${detail.height}"><g fill="white" stroke="#1677ff" stroke-width=".4" font-family="Arial" font-size="9">${marks.join('')}</g><rect x="${detail.object.x - detail.left}" y="${detail.object.y - detail.top}" width="${detail.object.width}" height="${detail.object.height}" fill="none" stroke="#e23b50" stroke-width="1"/></svg>`);
      return sharp(source).extract({ left: detail.left, top: detail.top, width: detail.width, height: detail.height }).composite([{ input: overlay }]).png().toBuffer().then(crop => sharp(crop).resize({ width: Math.min(1024, detail.width * 3), height: Math.min(1024, detail.height * 3), fit: 'inside' }).png().toBuffer());
    })]).then(([guide, ...closeups]) => {
      if (signal.aborted) throw new Error('图层分析已停止。');
      const iterator = this.provider.run({ taskId: task.id, images: [source, guide, ...closeups], schema, prompt: `Separate the actual foreground product and independent decorative objects with closed, traceable silhouettes in this ${width}x${height} image into editable image layers. Image 1 is the untouched original. Image 2 has pixel-coordinate grid lines only for locating silhouettes; never treat its lines or labels as scene content. Coordinates start at the ORIGINAL image top-left (0,0), including all blank borders. Do not crop or renormalize coordinates to the photo content. Return ORIGINAL pixel bounding boxes and short Chinese names. Give repeated types distinct position-based names so a rejected object is unambiguous. The first object is the complete main product, including its full container and visible contents as one object. Do not split pieces inside the container or attached product parts into decorative layers. Every bounding box must include the complete visible silhouette, not only an interior detail or container rim. Each other object must be one independently visible element outside the main product; do not group scattered decorations or repeat an element already included in another object. A cup and a separate saucer are different physical objects. Each loose bean is a single complete bean: never cut a bean at a box edge or combine fragments of neighboring beans. Exclude text, backgrounds, gradients, shadows, reflections, floor patterns, ambient lighting and atmospheric effects: these remain part of the background scene. No invented objects, return only the actual independent elements rather than filling the count, maximum 8 objects.${correction ? ` The red numbered rectangles in image 2 are the previous bounding boxes, not physical contours. Check which visible pixels extend outside each box; expand incomplete boxes to include the whole visible object, without including a neighbor. The previous local segmentation rejected this analysis: ${JSON.stringify(correction)}. Additional images are enlarged coordinate closeups, in this order: ${details.map((detail, index) => `image ${index + 3}: previous object #${detail.index + 1}, ORIGINAL crop left=${detail.left}, top=${detail.top}, width=${detail.width}, height=${detail.height}`).join("; ")}. Closeup grid labels are ORIGINAL pixel coordinates, not display pixels. Read the complete silhouette boundaries from these labels; do not multiply returned coordinates by the display enlargement. This is one allowed correction, not a request to discard difficult objects. Inspect all original silhouettes again, correct incomplete or mixed bounding boxes, and return a complete valid object list. Do not preserve an incorrect box just to match the earlier list.` : ''}` })[Symbol.asyncIterator]();
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
    });
  }
  private render(task: ImageToolTask, source: Buffer, signal: AbortSignal): Promise<LocalImageOutput> {
    const input = task.input; const asset = this.images.asset(input.sourceAssetId); const width = asset.width; const height = asset.height;
    const single = (data: Buffer, wide = width, tall = height): LocalImageOutput => ({ images: [{ data, width: wide, height: tall, name: names[input.operation] }], text: [] });
    if (input.operation === 'edit' || input.operation === 'erase' || input.operation === 'replace-text') {
      const prompt = input.operation === 'edit' ? `Edit this image according to the following visual requirements: ${input.prompt}` : input.operation === 'erase' ? 'Remove the marked objects and naturally reconstruct the underlying scene. Do not replace them with other objects.' : `Replace only the selected text with this exact text: ${input.text}. Preserve the original text color, font family, weight, size, position, baseline, spacing, perspective and surrounding background. Do not add a caption panel or recolor the text.`;
      return input.maskAssetId === null ? this.generate(task.id, source, prompt, width, height, signal).then(data => single(data)) : readFile(this.images.assetFile(input.maskAssetId)).then(mask => this.masked(task, source, mask, prompt, signal)).then(data => single(data));
    }
    if (input.operation === 'upscale') return this.generate(task.id, source, `Enhance this image to ${input.scale}x resolution. Recover realistic fine detail and reduce compression artifacts without altering any object, text, color or composition. Do not add content.`, width * input.scale, height * input.scale, signal).then(data => single(data, width * input.scale, height * input.scale));
    if (input.operation === 'expand') {
      return sharp({ create: { width: input.width, height: input.height, channels: 4, background: '#808080' } }).composite([{ input: source, left: input.x, top: input.y }]).png().toBuffer()
        /* 按示意中的原图位置扩展，避免模型缩放主体后与原图硬拼产生断裂。 */
        .then(guide => this.generate(task.id, source, `Return one outpainted image of exactly ${input.width}x${input.height} pixels. Image 1 is the untouched original ${width}x${height} photograph. Image 2 is the target canvas layout: the original is placed at x=${input.x}, y=${input.y}, without scaling; only the grey area is new. Keep this placement and the original object scale, perspective, contours, lighting and texture exactly. Continue every cut object and surface across the original rectangle boundaries seamlessly. Do not zoom, shift, recreate, frame or stretch the original. No grey margins or rectangular seams. The original rectangle will be copied back unchanged, so the new pixels must meet its exact original edge positions and colors. Visual requirements: ${input.prompt}`, input.width, input.height, signal, guide))
        .then(data => sharp(data).composite([{ input: source, left: input.x, top: input.y }]).png().toBuffer()).then(data => single(data, input.width, input.height));
    }
    /* 范围纠正会重新启动本地步骤，界面进度保留已到达的位置，避免倒退。 */
    const progress = (value: number) => { if (signal.aborted || this.stopped) return; const current = this.task(task.id); if (current.status === 'running') this.update(task.id, 'running', Math.max(current.progress, Math.round(10 + value * .75))); };
    if (input.operation === 'recognize-text' || input.operation === 'cutout') return this.provider.processImage(task.id, source, { operation: input.operation }, signal, progress);
    /* 清字与像素处理在本地完成；拆层仅用一次模型分析语义分组，不再逐层调用生图生成蒙版。 */
    return this.provider.processImage(task.id, source, { operation: 'prepare-layers' }, signal, value => progress(Math.round(value * .3))).then(prepared => {
      const clean = prepared.images[0].data;
      return this.objects(task, clean, signal).then(objects => this.provider.processImage(task.id, clean, { operation: 'split-layers', objects }, signal, value => progress(Math.round(35 + value * .65)))
        .catch((error: Error) => {
          if (!(error instanceof LayerSegmentationError) || signal.aborted) throw error;
          /* 只允许一次明确的语义范围纠正；再次失败不落结果，不无限重跑或切换生图。 */
          return this.objects(task, clean, signal, { objects, name: error.layerName, message: error.message }).then(corrected => this.provider.processImage(task.id, clean, { operation: 'split-layers', objects: corrected }, signal, value => progress(Math.round(35 + value * .65))));
        }))
        .then(output => ({ ...output, text: prepared.text }));
    });
  }
  private close(): Promise<void> {
    this.stopped = true; this.queue.length = 0; this.running?.signal.abort(); this.changes.complete();
    return (this.running ? this.provider.cancel(this.running.id).catch(() => {}) : Promise.resolve()).then(() => this.work);
  }
}
