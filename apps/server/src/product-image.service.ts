import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, type OnApplicationShutdown } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Subject } from 'rxjs';
import { prepareProductImage, type CommerceImageRenderer } from '@photo-studio/tools';
import { validateProductImageParameters, type AgentExecutionStep, type EditorLayer, type ImageToolInput, type ProductAsset, type ProductImageParameters, type ProductImageResult, type ProductImageTask } from '@photo-studio/shared';
import { StorageService } from './storage.service';
import { ProjectsService } from './projects.service';
import { ImageGenerationError } from '@photo-studio/ai-provider';

export const PRODUCT_IMAGE_TOOL = Symbol('product-image');
const assetColumns = 'id, name, mime_type AS mimeType, size, width, height, created_at AS createdAt';
const taskColumns = 'id, parameters, status, progress, created_at AS createdAt, updated_at AS updatedAt, error';
const resultColumns = 'id, task_id AS taskId, name, width, height, created_at AS createdAt, project_id AS projectId';

@Injectable()
export class ProductImageService implements OnApplicationShutdown {
  readonly changes = new Subject<ProductImageTask>();
  private readonly queue: (ProductImageTask & { feedback: string })[] = [];
  private running: { id: string; signal: AbortController } | null = null;
  private work: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(@Inject(StorageService) private readonly storage: StorageService, @Inject(ProjectsService) private readonly projects: ProjectsService, @Inject(PRODUCT_IMAGE_TOOL) private readonly render: CommerceImageRenderer) {
    this.storage.beforeClose.push(() => this.onApplicationShutdown());
    this.storage.database.prepare("UPDATE product_image_tasks SET status = 'failed', error = ?, updated_at = ? WHERE status IN ('queued', 'running')").run('服务已重新启动，图片任务已中断，请重试。', new Date().toISOString());
  }

  assets(): ProductAsset[] { return this.storage.database.prepare(`SELECT ${assetColumns} FROM product_assets ORDER BY created_at DESC, rowid DESC`).all() as unknown as ProductAsset[]; }
  asset(id: string): ProductAsset {
    const asset = this.storage.database.prepare(`SELECT ${assetColumns} FROM product_assets WHERE id = ?`).get(id) as unknown as ProductAsset | undefined;
    if (!asset) throw new NotFoundException('商品素材不存在。');
    return asset;
  }
  assetFile(id: string): string { this.asset(id); return this.file('uploads', id); }
  removeAsset(id: string): { id: string } {
    const database = this.storage.database;
    database.exec('BEGIN IMMEDIATE');
    /* 素材物理删除前检查执行队列与编辑图层，历史参数保留，重试时必须重新选择有效素材。 */
    try {
      this.asset(id);
      const active = ['product_image_tasks', 'commerce_tasks'].some(table => database.prepare(`SELECT parameters FROM ${table} WHERE status IN ('queued', 'running')`).all().some(row => (JSON.parse(row.parameters as string) as ProductImageParameters).sourceAssetId === id))
        || !!database.prepare("SELECT plan_task_id FROM agent_auto_flows WHERE source_asset_id = ? AND status IN ('planning', 'preparing', 'executing') LIMIT 1").get(id)
        || database.prepare(`SELECT steps FROM agent_executions WHERE status IN ('queued', 'running')`).all().some(row => (JSON.parse(row.steps as string) as AgentExecutionStep[]).some(step => step.parameters.sourceAssetId === id))
        || database.prepare(`SELECT input FROM image_tool_tasks WHERE status IN ('queued', 'running')`).all().some(row => {
          const input = JSON.parse(row.input as string) as ImageToolInput;
          return input.sourceAssetId === id || 'maskAssetId' in input && input.maskAssetId === id;
        });
      if (active) throw new ConflictException('素材正在被任务使用，请等待完成或停止后再删除。');
      if (database.prepare('SELECT layers FROM editor_documents').all().some(row => (JSON.parse(row.layers as string) as EditorLayer[]).some(layer => layer.type === 'asset-image' && (layer.assetId === id || layer.matteSourceAssetId === id)))) {
        throw new ConflictException('素材正在被已保存作品使用，请先移除对应图层后再删除。');
      }
      database.prepare('UPDATE product_image_tasks SET source_asset_id = NULL WHERE source_asset_id = ?').run(id);
      database.prepare('DELETE FROM product_assets WHERE id = ?').run(id);
      database.exec('COMMIT');
    } catch (error) { database.exec('ROLLBACK'); throw error; }
    return { id };
  }
  resultFile(id: string): string { this.result(id); return this.file('generated', id); }
  private file(directory: 'uploads' | 'generated', id: string): string {
    const path = resolve(this.storage.dataDirectory, directory, `${id}.png`);
    if (!existsSync(path)) throw new NotFoundException('图片文件无法读取，请重新上传或生成。');
    return path;
  }

  upload(input: Buffer | undefined, name: unknown): Promise<ProductAsset> {
    if (!input) throw new BadRequestException('请选择商品图片。');
    if (typeof name !== 'string' || !name.trim() || [...name.trim()].length > 200) throw new BadRequestException('素材名称必须为 1 到 200 个字符。');
    return prepareProductImage(input).catch(() => { throw new BadRequestException('无法读取图片，请使用 20 MB 以内、最多 1600 万像素的静态 PNG、JPG 或 WebP。'); })
      .then(({ data, width, height }) => {
        const asset: ProductAsset = { id: randomUUID(), name: name.trim(), mimeType: 'image/png', size: data.length, width, height, createdAt: new Date().toISOString() };
        const path = resolve(this.storage.dataDirectory, 'uploads', `${asset.id}.png`);
        return writeFile(path, data).then(() => {
          this.storage.database.prepare('INSERT INTO product_assets VALUES (?, ?, ?, ?, ?, ?, ?)').run(asset.id, asset.name, asset.mimeType, asset.size, width, height, asset.createdAt);
          return asset;
        });
      });
  }

  list(): ProductImageTask[] {
    return this.storage.database.prepare(`SELECT ${taskColumns} FROM product_image_tasks ORDER BY created_at DESC, rowid DESC`).all().map((row) => ({ ...row, parameters: JSON.parse(row.parameters as string) })) as unknown as ProductImageTask[];
  }
  task(id: string): ProductImageTask {
    const row = this.storage.database.prepare(`SELECT ${taskColumns} FROM product_image_tasks WHERE id = ?`).get(id);
    if (!row) throw new NotFoundException('图片任务不存在。');
    return { ...row, parameters: JSON.parse(row.parameters as string) } as unknown as ProductImageTask;
  }
  results(id: string): ProductImageResult[] {
    this.task(id);
    return this.storage.database.prepare(`SELECT ${resultColumns} FROM product_image_results WHERE task_id = ? ORDER BY created_at, rowid`).all(id) as unknown as ProductImageResult[];
  }
  result(id: string): ProductImageResult {
    const result = this.storage.database.prepare(`SELECT ${resultColumns} FROM product_image_results WHERE id = ? UNION ALL SELECT ${resultColumns} FROM commerce_results WHERE id = ? UNION ALL SELECT ${resultColumns} FROM image_tool_results WHERE id = ?`).get(id, id, id) as unknown as ProductImageResult | undefined;
    if (!result) throw new NotFoundException('生成结果不存在。');
    return result;
  }
  projectResults(id: string): ProductImageResult[] {
    this.projects.findOne(id);
    return this.storage.database.prepare(`SELECT ${resultColumns} FROM product_image_results WHERE project_id = ? UNION ALL SELECT ${resultColumns} FROM commerce_results WHERE project_id = ? UNION ALL SELECT ${resultColumns} FROM image_tool_results WHERE project_id = ? ORDER BY createdAt DESC, id DESC`).all(id, id, id) as unknown as ProductImageResult[];
  }

  submit(input: unknown, feedback = ''): ProductImageTask {
    let parameters: ProductImageParameters;
    try { parameters = validateProductImageParameters(input); } catch (error) { throw new BadRequestException((error as Error).message); }
    if (parameters.sourceAssetId !== null) this.asset(parameters.sourceAssetId);
    if (this.stopped) throw new ConflictException('图片工具正在停止，请稍后重试。');
    if (this.queue.length >= 10) throw new ConflictException('等待中的图片任务较多，请稍后提交。');
    const now = new Date().toISOString();
    const task: ProductImageTask = { id: randomUUID(), parameters, status: 'queued', progress: 0, createdAt: now, updatedAt: now, error: null };
    this.storage.database.prepare('INSERT INTO product_image_tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(task.id, parameters.sourceAssetId, JSON.stringify(parameters), task.status, 0, now, now, null);
    this.queue.push({ ...task, feedback }); this.changes.next(task);
    queueMicrotask(() => this.pump());
    return task;
  }
  retry(id: string): ProductImageTask { return this.submit(this.task(id).parameters); }
  retryResult(id: string): ProductImageTask { return this.submit({ ...this.task(this.result(id).taskId).parameters, count: 1 }); }

  save(id: string, projectId: unknown): ProductImageResult {
    if (typeof projectId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) throw new BadRequestException('请选择有效项目。');
    const result = this.result(id);
    this.resultFile(id); this.projects.findOne(projectId);
    if (result.projectId === projectId) return result;
    const database = this.storage.database;
    database.exec('BEGIN');
    try {
      database.prepare('UPDATE product_image_results SET project_id = ? WHERE id = ?').run(projectId, id);
      database.prepare('UPDATE commerce_results SET project_id = ? WHERE id = ?').run(projectId, id);
      database.prepare('UPDATE image_tool_results SET project_id = ? WHERE id = ?').run(projectId, id);
      database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), projectId);
      database.exec('COMMIT');
    } catch (error) { database.exec('ROLLBACK'); throw error; }
    return { ...result, projectId };
  }

  cancel(id: string): ProductImageTask {
    const task = this.task(id);
    if (!['queued', 'running'].includes(task.status)) return task;
    const index = this.queue.findIndex((queued) => queued.id === id);
    if (index !== -1) this.queue.splice(index, 1);
    if (this.running?.id === id) this.running.signal.abort();
    return this.update(id, 'cancelled', task.progress);
  }
  private update(id: string, status: ProductImageTask['status'], progress: number, error: string | null = null): ProductImageTask {
    this.storage.database.prepare('UPDATE product_image_tasks SET status = ?, progress = ?, error = ?, updated_at = ? WHERE id = ?').run(status, progress, error, new Date().toISOString(), id);
    const task = this.task(id); this.changes.next(task); return task;
  }

  private pump() {
    if (this.running || this.stopped) return;
    const task = this.queue.shift(); if (!task) return;
    const signal = new AbortController(); this.running = { id: task.id, signal };
    this.update(task.id, 'running', 5);
    /* 图片任务最多执行十五分钟；超时先落库为失败，再中止工具，迟到结果不能覆盖终态。 */
    const timeout = setTimeout(() => {
      if (this.stopped || signal.signal.aborted) return;
      signal.abort();
      this.update(task.id, 'failed', this.task(task.id).progress, '图片任务执行超时，请检查 Codex 后重试。');
    }, 15 * 60 * 1000);
    const directory = resolve(this.storage.dataDirectory, 'runs', `product-image-${task.id}`);
    const source = resolve(directory, 'source.png');
    const check = () => { if (signal.signal.aborted || this.stopped) throw new Error('任务已取消。'); };
    /* 串行处理独立目录里的素材；每张文件写入成功后落库并推进进度，取消时保留已完成结果。 */
    this.work = Promise.resolve().then(() => { check(); return mkdir(directory, { recursive: true }); })
      .then(() => { check(); if (task.parameters.sourceAssetId !== null) return copyFile(this.assetFile(task.parameters.sourceAssetId), source); })
      .then(() => writeFile(resolve(directory, 'parameters.json'), JSON.stringify(task.parameters), 'utf8'))
      .then(() => { if (task.feedback) return writeFile(resolve(directory, 'review-feedback.txt'), task.feedback, 'utf8'); })
      .then(() => task.parameters.sourceAssetId === null ? null : readFile(source))
      .then((input) => {
        let images: Promise<void> = Promise.resolve();
        for (let index = 0; index < task.parameters.count; index++) {
          images = images.then(() => { check(); return this.render(input, task.parameters, index, signal.signal, undefined, task.feedback); })
            .then(({ data, width, height }) => {
              check();
              const result: ProductImageResult = { id: randomUUID(), taskId: task.id, name: `商品图_${index + 1}.png`, width, height, createdAt: new Date().toISOString(), projectId: null };
              const path = resolve(this.storage.dataDirectory, 'generated', `${result.id}.png`);
              return writeFile(path, data).then(() => {
                if (signal.signal.aborted || this.stopped) return unlink(path).then(() => { throw new Error('任务已取消。'); });
                this.storage.database.prepare('INSERT INTO product_image_results VALUES (?, ?, ?, ?, ?, ?, ?)').run(result.id, task.id, result.name, width, height, result.createdAt, null);
                this.update(task.id, 'running', Math.round(5 + 90 * (index + 1) / task.parameters.count));
              });
            });
        }
        return images;
      }).then(() => { check(); this.update(task.id, 'succeeded', 100); })
      .catch((error: Error) => { if (!signal.signal.aborted && !this.stopped) this.update(task.id, 'failed', this.task(task.id).progress, error instanceof ImageGenerationError ? error.message : '图片生成失败，请检查素材和本地文件后重试。'); })
      .finally(() => { clearTimeout(timeout); this.running = null; if (!this.stopped) this.pump(); });
  }

  onApplicationShutdown(): Promise<void> {
    this.stopped = true; this.queue.length = 0; this.running?.signal.abort(); this.changes.complete();
    return this.work;
  }
}
