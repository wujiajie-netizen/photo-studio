import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { validateEditorContent, type EditorContent, type EditorDocument, type CreationScene } from '@photo-studio/shared';
import { StorageService } from './storage.service';
import { ProductImageService } from './product-image.service';
import { renderEditorContent } from './editor-renderer';

const columns = 'id, result_id AS resultId, project_id AS projectId, name, width, height, background, layers, revision, created_at AS createdAt, updated_at AS updatedAt';
@Injectable()
export class EditorService {
  constructor(@Inject(StorageService) private readonly storage: StorageService, @Inject(ProductImageService) private readonly images: ProductImageService) {}
  scene(sessionId: string): CreationScene {
    if (!this.storage.database.prepare('SELECT id FROM agent_sessions WHERE id = ? AND deleted_at IS NULL').get(sessionId)) throw new NotFoundException('创作会话不存在。');
    const row = this.storage.database.prepare('SELECT boards, viewport, selected_id AS selectedId, revision FROM creation_scenes WHERE session_id = ?').get(sessionId);
    return row ? { boards: JSON.parse(row.boards as string), viewport: JSON.parse(row.viewport as string), selectedId: row.selectedId as string | null, revision: row.revision as number } : { boards: [], viewport: { x: 0, y: 0, zoom: 1 }, selectedId: null, revision: 0 };
  }
  saveScene(sessionId: string, input: unknown): CreationScene {
    const saved = this.scene(sessionId);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 4) throw new BadRequestException('画板布局字段无效。');
    const scene = input as CreationScene; const position = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000;
    if (!Number.isInteger(scene.revision) || scene.revision < 0 || !Array.isArray(scene.boards) || scene.boards.length > 2000 || !scene.viewport || Array.isArray(scene.viewport) || Object.keys(scene.viewport).length !== 3 || !position(scene.viewport.x) || !position(scene.viewport.y) || !Number.isFinite(scene.viewport.zoom) || scene.viewport.zoom < .03 || scene.viewport.zoom > 3) throw new BadRequestException('画板位置、缩放或选择无效。');
    const taskIds = new Set(this.storage.database.prepare('SELECT steps FROM agent_executions WHERE session_id = ?').all(sessionId).flatMap(row => (JSON.parse(row.steps as string) as { taskId: string | null }[]).map(step => step.taskId)));
    const projectIds = new Set(this.storage.database.prepare('SELECT project_id FROM agent_sessions WHERE id = ? UNION SELECT project_id FROM agent_executions WHERE session_id = ?').all(sessionId, sessionId).map(row => row.project_id));
    const ids = new Set<string>();
    for (const board of scene.boards) {
      if (!board || Object.keys(board).length !== 3 || typeof board.resultId !== 'string' || ids.has(board.resultId) || !position(board.x) || !position(board.y)) throw new BadRequestException('画板内容或位置无效。');
      const result = this.images.result(board.resultId);
      if (!(result.projectId && projectIds.has(result.projectId)) && !taskIds.has(result.taskId) && !this.storage.database.prepare('SELECT id FROM image_tool_tasks WHERE id = ? AND session_id = ?').get(result.taskId, sessionId)) throw new BadRequestException('画板只能引用当前会话或关联项目中的作品。');
      ids.add(board.resultId);
    }
    if (scene.selectedId !== null && !ids.has(scene.selectedId)) throw new BadRequestException('请选择布局中的画板。');
    if (scene.revision !== saved.revision) {
      if (JSON.stringify(scene.boards) === JSON.stringify(saved.boards) && JSON.stringify(scene.viewport) === JSON.stringify(saved.viewport) && scene.selectedId === saved.selectedId) return saved;
      throw new ConflictException('其他窗口已更新画板布局，当前布局保留在页面中。请重新读取后继续排列。');
    }
    /* 同步 SQLite 保存布局和视口，版本条件避免两个窗口互相覆盖位置。 */
    this.storage.database.prepare('INSERT INTO creation_scenes VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET boards = excluded.boards, viewport = excluded.viewport, selected_id = excluded.selected_id, revision = excluded.revision, updated_at = excluded.updated_at').run(sessionId, JSON.stringify(scene.boards), JSON.stringify(scene.viewport), scene.selectedId, scene.revision + 1, new Date().toISOString());
    return this.scene(sessionId);
  }
  document(id: string): EditorDocument {
    const row = this.storage.database.prepare(`SELECT ${columns} FROM editor_documents WHERE id = ?`).get(id);
    if (!row) throw new NotFoundException('编辑文档不存在。');
    const result = this.images.result(row.resultId as string);
    const document = { ...row, projectId: result.projectId, layers: JSON.parse(row.layers as string) } as unknown as EditorDocument;
    const base = document.layers.find(layer => layer.type === 'image' && layer.resultId === document.resultId && layer.name === '商品原图');
    const productImage = this.storage.database.prepare('SELECT 1 FROM product_image_results WHERE id = ?').get(document.resultId);
    if (productImage && base?.type === 'image') {
      const coversCanvas = base.rotation === 0 && base.opacity === 1 && base.visible && base.x <= 0 && base.y <= 0 && base.x + base.width >= document.width && base.y + base.height >= document.height;
      /* 历史整图若仍完整覆盖画布，只移除无用底色并固定；单层整图已被移出时恢复原始画幅。 */
      if (coversCanvas || document.layers.length === 1) {
        const layer = coversCanvas ? { ...base, locked: true } : { ...base, x: 0, y: 0, width: result.width, height: result.height, rotation: 0, opacity: 1, visible: true, locked: true };
        if (document.background !== 'transparent' || JSON.stringify(layer) !== JSON.stringify(base)) {
          document.background = 'transparent'; document.layers = document.layers.map(item => item.id === base.id ? layer : item); document.revision += 1; document.updatedAt = new Date().toISOString();
          this.storage.database.prepare('UPDATE editor_documents SET background = ?, layers = ?, revision = ?, updated_at = ? WHERE id = ?').run(document.background, JSON.stringify(document.layers), document.revision, document.updatedAt, document.id);
        }
      }
    }
    return document;
  }
  exportResult(resultId: string): Promise<{ data: Buffer; width: number; height: number }> {
    return this.exportDocument(this.open(resultId));
  }
  exportDocument(document: EditorDocument): Promise<{ data: Buffer; width: number; height: number }> {
    const { name, width, height, background, layers } = document;
    return renderEditorContent({ name, width, height, background, layers }, (kind, id) => kind === 'image' ? this.images.resultFile(id) : this.images.assetFile(id)).then(data => ({ data, width, height }));
  }
  open(resultId: unknown): EditorDocument {
    if (typeof resultId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(resultId)) throw new BadRequestException('请选择有效的生成图片。');
    const result = this.images.result(resultId); this.images.resultFile(resultId);
    const saved = this.storage.database.prepare('SELECT id FROM editor_documents WHERE result_id = ?').get(resultId);
    if (saved) return this.document(saved.id as string);
    const now = new Date().toISOString();
    const document: EditorDocument = { id: randomUUID(), resultId, projectId: result.projectId, name: result.name, width: result.width, height: result.height, background: 'transparent', layers: [{ id: randomUUID(), type: 'image', name: '商品原图', resultId, x: 0, y: 0, width: result.width, height: result.height, rotation: 0, opacity: 1, visible: true, locked: true }], revision: 0, createdAt: now, updatedAt: now };
    this.storage.database.prepare('INSERT INTO editor_documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(document.id, resultId, document.projectId, document.name, document.width, document.height, document.background, JSON.stringify(document.layers), 0, now, now);
    return document;
  }
  save(id: string, input: unknown): EditorDocument {
    const document = this.document(id);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 6) throw new BadRequestException('编辑内容或版本号无效。');
    const { revision, ...content } = input as EditorContent & { revision: number };
    if (!Number.isInteger(revision) || revision < 0) throw new BadRequestException('编辑版本号无效。');
    try { validateEditorContent(content); } catch (error) { throw new BadRequestException((error as Error).message); }
    for (const layer of content.layers) {
      if (layer.type === 'image') this.images.resultFile(layer.resultId);
      if (layer.type === 'asset-image') this.images.assetFile(layer.assetId);
      if (layer.type === 'asset-image' && layer.matteSourceAssetId) {
        this.images.assetFile(layer.matteSourceAssetId);
        const original = this.images.asset(layer.matteSourceAssetId); const image = this.images.asset(layer.assetId);
        if (original.width !== image.width || original.height !== image.height) throw new BadRequestException('原素材与抠图修整图片尺寸必须一致。');
      }
    }
    const savedBase = document.layers.find(layer => layer.type === 'image' && layer.resultId === document.resultId && layer.name === '商品原图');
    const fixed = savedBase?.type === 'image' && document.background === 'transparent' && savedBase.locked && savedBase.rotation === 0 && savedBase.opacity === 1 && savedBase.visible && savedBase.x <= 0 && savedBase.y <= 0 && savedBase.x + savedBase.width >= document.width && savedBase.y + savedBase.height >= document.height;
    if (fixed) {
      const base = content.layers.find(layer => layer.id === savedBase.id);
      if (!base || base.type !== 'image' || base.resultId !== document.resultId || content.background !== 'transparent' || !base.locked || base.rotation !== 0 || base.opacity !== 1 || !base.visible || base.x > 0 || base.y > 0 || base.x + base.width < content.width || base.y + base.height < content.height) throw new BadRequestException('生成整图必须固定并完整覆盖画布。');
    }
    /* 带版本条件保存，防止其他窗口覆盖文档；冲突时保留客户端内容，用户可另行重新读取。 */
    const change = this.storage.database.prepare('UPDATE editor_documents SET name = ?, width = ?, height = ?, background = ?, layers = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?').run(content.name.trim(), content.width, content.height, content.background, JSON.stringify(content.layers), new Date().toISOString(), id, revision);
    if (!change.changes) throw new ConflictException('其他窗口已更新此作品，当前修改保留在页面中。请下载当前作品后重新读取。');
    const saved = this.document(id);
    if (saved.projectId) this.storage.database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(saved.updatedAt, saved.projectId);
    return saved;
  }
}
