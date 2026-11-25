import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, type OnApplicationShutdown } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Subject } from 'rxjs';
import { planWithAgent } from '@photo-studio/agent';
import type { AgentModelProvider } from '@photo-studio/ai-provider';
import { validateAgentResult, type AgentMessage, type AgentResult, type AgentSession, type AgentTask } from '@photo-studio/shared';
import { StorageService } from './storage.service';

export const AGENT_MODEL_PROVIDER = Symbol('AGENT_MODEL_PROVIDER');
const sessionColumns = 'id, title, project_id AS projectId, pinned_at AS pinnedAt, deleted_at AS deletedAt, created_at AS createdAt, updated_at AS updatedAt';
const taskColumns = 'id, session_id AS sessionId, status, created_at AS createdAt, updated_at AS updatedAt, error';

@Injectable()
export class AgentService implements OnApplicationShutdown {
  readonly changes = new Subject<AgentTask>();
  private readonly queue: { task: AgentTask; prompt: string }[] = [];
  private running: { task: AgentTask; signal: AbortController } | null = null;
  private stopped = false;
  private work: Promise<void> = Promise.resolve();

  constructor(@Inject(StorageService) private readonly storage: StorageService, @Inject(AGENT_MODEL_PROVIDER) private readonly provider: AgentModelProvider) {
    this.storage.beforeClose.push(() => this.onApplicationShutdown());
    /* 重启后把未完成任务保留为明确失败；不自动重复收费调用，用户可从已保存的消息重试。 */
    this.storage.database.prepare("UPDATE agent_tasks SET status = 'failed', error = ?, updated_at = ? WHERE status IN ('queued', 'running')").run('本地服务已重新启动，任务已中断，请重试。', new Date().toISOString());
  }

  list(): AgentSession[] {
    return this.storage.database.prepare(`SELECT ${sessionColumns} FROM agent_sessions WHERE deleted_at IS NULL ORDER BY pinned_at DESC, updated_at DESC, rowid DESC`).all() as unknown as AgentSession[];
  }

  session(id: string): AgentSession {
    const session = this.storage.database.prepare(`SELECT ${sessionColumns} FROM agent_sessions WHERE id = ? AND deleted_at IS NULL`).get(id) as unknown as AgentSession | undefined;
    if (!session) throw new NotFoundException('会话不存在。');
    return session;
  }

  rename(id: string, title: unknown): AgentSession {
    if (typeof title !== 'string' || !title.trim() || [...title.trim()].length > 80) throw new BadRequestException('请输入 1 到 80 个字符的对话名称。');
    this.session(id);
    this.storage.database.prepare('UPDATE agent_sessions SET title = ?, updated_at = ? WHERE id = ?').run(title.trim(), new Date().toISOString(), id);
    return this.session(id);
  }

  manage(input: unknown): AgentSession[] {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('对话操作参数无效。');
    const body = input as { ids: unknown; action: unknown };
    if (Object.keys(body).sort().join(',') !== 'action,ids' || !['pin', 'unpin', 'delete'].includes(body.action as string) || !Array.isArray(body.ids) || !body.ids.length || body.ids.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) || new Set(body.ids).size !== body.ids.length) throw new BadRequestException('请选择有效且不重复的对话，并指定操作。');
    const ids = body.ids as string[]; const database = this.storage.database; const now = new Date().toISOString();
    /* 先检查整批会话，再在同一事务中写入；有任务进行时禁止删除，保留项目、作品和关联记录。 */
    database.exec('BEGIN IMMEDIATE;');
    try {
      ids.forEach(id => {
        this.session(id);
        if (body.action === 'delete' && ['agent_tasks', 'agent_executions', 'image_tool_tasks'].some(table => database.prepare(`SELECT id FROM ${table} WHERE session_id = ? AND status IN ('queued', 'running') LIMIT 1`).get(id))) throw new ConflictException('选中的对话还有任务进行中，请等待完成或停止任务后再删除。');
        if (body.action === 'delete' && database.prepare("SELECT f.plan_task_id FROM agent_auto_flows f JOIN agent_tasks t ON t.id = f.plan_task_id WHERE t.session_id = ? AND f.status IN ('planning', 'preparing', 'executing') LIMIT 1").get(id)) throw new ConflictException('选中的对话还有任务进行中，请等待完成或停止任务后再删除。');
        if (body.action === 'delete' && database.prepare("SELECT c.execution_id FROM agent_publication_copy c JOIN agent_executions e ON e.id = c.execution_id WHERE e.session_id = ? AND c.status IN ('queued', 'running') LIMIT 1").get(id)) throw new ConflictException('选中的对话还有文案生成中，请等待完成后再删除。');
      });
      const statement = database.prepare(body.action === 'delete' ? 'UPDATE agent_sessions SET deleted_at = ? WHERE id = ?' : body.action === 'pin' ? 'UPDATE agent_sessions SET pinned_at = COALESCE(pinned_at, ?) WHERE id = ?' : 'UPDATE agent_sessions SET pinned_at = ? WHERE id = ?');
      ids.forEach(id => statement.run(body.action === 'unpin' ? null : now, id));
      database.exec('COMMIT;');
    } catch (error) { database.exec('ROLLBACK;'); throw error; }
    return this.list();
  }

  messages(id: string): AgentMessage[] {
    this.session(id);
    return this.storage.database.prepare('SELECT id, session_id AS sessionId, role, content, created_at AS createdAt FROM agent_messages WHERE session_id = ? ORDER BY created_at, rowid').all(id) as unknown as AgentMessage[];
  }

  tasks(id: string): AgentTask[] {
    this.session(id);
    return this.storage.database.prepare(`SELECT ${taskColumns} FROM agent_tasks WHERE session_id = ? ORDER BY created_at, rowid`).all(id) as unknown as AgentTask[];
  }

  task(id: string): AgentTask {
    const task = this.storage.database.prepare(`SELECT ${taskColumns} FROM agent_tasks WHERE id = ?`).get(id) as unknown as AgentTask | undefined;
    if (!task) throw new NotFoundException('任务不存在。');
    this.session(task.sessionId);
    return task;
  }

  result(id: string): AgentResult {
    if (this.task(id).status !== 'succeeded') throw new ConflictException('任务尚无可读取的计划。');
    try { return validateAgentResult(JSON.parse(readFileSync(resolve(this.storage.dataDirectory, 'runs', id, 'result.json'), 'utf8'))); }
    catch { throw new NotFoundException('计划文件无法读取，请重新提交需求。'); }
  }

  submit(content: unknown, sessionId?: string, auto?: { sourceAssetId: unknown; projectId: unknown }): AgentTask {
    if (typeof content !== 'string' || !content.trim() || [...content.trim()].length > 2000) throw new BadRequestException('请输入 1 到 2000 个字符的需求。');
    if (this.stopped) throw new ConflictException('本地服务正在停止，请稍后重试。');
    if (this.queue.length >= 10) throw new ConflictException('等待中的计划已达上限，请稍后再提交。');
    if (auto) {
      const validId = (id: unknown): id is string | null => id === null || typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
      if (!validId(auto.sourceAssetId) || !validId(auto.projectId)) throw new BadRequestException('素材或项目编号无效。');
      if (auto.sourceAssetId !== null && !this.storage.database.prepare('SELECT id FROM product_assets WHERE id = ?').get(auto.sourceAssetId)) throw new BadRequestException('商品素材不存在。');
      if (auto.projectId !== null && !this.storage.database.prepare('SELECT id FROM projects WHERE id = ?').get(auto.projectId)) throw new BadRequestException('项目不存在。');
    }
    if (sessionId) {
      this.session(sessionId);
      if (this.tasks(sessionId).some((task) => ['queued', 'running'].includes(task.status))) throw new ConflictException('当前会话的任务尚未结束，请等待或取消后再提交。');
    }
    const now = new Date().toISOString();
    const id = sessionId ?? randomUUID();
    const task: AgentTask = { id: randomUUID(), sessionId: id, status: 'queued', createdAt: now, updatedAt: now, error: null };
    const database = this.storage.database;
    /* 会话、用户消息和等待任务一并落库，提交成功后才加入内存队列并推送状态。 */
    database.exec('BEGIN');
    try {
      if (!sessionId) database.prepare('INSERT INTO agent_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, [...content.trim()].slice(0, 80).join(''), now, now);
      else database.prepare('UPDATE agent_sessions SET updated_at = ? WHERE id = ?').run(now, id);
      database.prepare('INSERT INTO agent_messages VALUES (?, ?, ?, ?, ?)').run(randomUUID(), id, 'user', content.trim(), now);
      database.prepare('INSERT INTO agent_tasks VALUES (?, ?, ?, ?, ?, ?)').run(task.id, id, task.status, now, now, null);
      if (auto) database.prepare("INSERT INTO agent_auto_flows (plan_task_id, source_asset_id, project_id, status, error, execution_id) VALUES (?, ?, ?, 'planning', NULL, NULL)").run(task.id, auto.sourceAssetId as string | null, auto.projectId as string | null);
      database.exec('COMMIT');
    } catch (error) { database.exec('ROLLBACK'); throw error; }
    this.queue.push({ task, prompt: content.trim() });
    this.changes.next(task);
    queueMicrotask(() => this.pump());
    return task;
  }

  cancel(id: string): AgentTask {
    const task = this.task(id);
    if (!['queued', 'running'].includes(task.status)) return task;
    const updated = this.update(id, 'cancelled');
    const queued = this.queue.findIndex((entry) => entry.task.id === id);
    if (queued !== -1) this.queue.splice(queued, 1);
    if (this.running?.task.id === id) {
      this.running.signal.abort();
      this.provider.cancel(id).catch(() => {});
    }
    return updated;
  }

  private update(id: string, status: AgentTask['status'], error: string | null = null): AgentTask {
    const now = new Date().toISOString();
    this.storage.database.prepare('UPDATE agent_tasks SET status = ?, error = ?, updated_at = ? WHERE id = ?').run(status, error, now, id);
    const task = this.task(id);
    this.storage.database.prepare('UPDATE agent_sessions SET updated_at = ? WHERE id = ?').run(now, task.sessionId);
    this.changes.next(task);
    return task;
  }

  private pump() {
    if (this.running || this.stopped) return;
    const entry = this.queue.shift();
    if (!entry) return;
    const signal = new AbortController();
    this.running = { task: entry.task, signal };
    this.update(entry.task.id, 'running');
    const row = this.storage.database.prepare('SELECT provider_session_id FROM agent_sessions WHERE id = ?').get(entry.task.sessionId)!;
    const providerSessionId = row.provider_session_id as string | null;
    /* 每次只执行一个模型任务；取消后丢弃迟到结果，失败保留会话与消息，下一条消息可继续恢复。 */
    const context = JSON.stringify(this.messages(entry.task.sessionId).map(message => ({ role: message.role, content: message.content })));
    const questions = this.tasks(entry.task.sessionId).filter(task => task.status === 'succeeded').flatMap(task => {
      try { return this.result(task.id).questions; } catch (error) { if (error instanceof NotFoundException) return []; throw error; }
    });
    const source = this.storage.database.prepare('SELECT source_asset_id FROM agent_auto_flows WHERE plan_task_id = ?').get(entry.task.id);
    this.work = planWithAgent(this.provider, entry.task.id, `完整会话记录：${context}\n此前助手的澄清问题（不是用户提供的事实）：${JSON.stringify(questions)}\n${source ? source.source_asset_id ? '本轮已绑定商品素材，不要追问是否上传素材。\n' : '本轮没有绑定商品素材。\n' : ''}本轮用户需求：${entry.prompt}`, providerSessionId, signal.signal, (event) => {
      if (event.type === 'started' && !signal.signal.aborted) this.storage.database.prepare('UPDATE agent_sessions SET provider_session_id = ? WHERE id = ?').run(event.sessionId, entry.task.sessionId);
    }).then((result) => {
      if (signal.signal.aborted || this.stopped) return;
      const directory = resolve(this.storage.dataDirectory, 'runs', entry.task.id);
      mkdirSync(directory, { recursive: true });
      writeFileSync(resolve(directory, 'result.json'), JSON.stringify(result), 'utf8');
      this.storage.database.prepare('INSERT INTO agent_messages VALUES (?, ?, ?, ?, ?)').run(randomUUID(), entry.task.sessionId, 'assistant', result.summary, new Date().toISOString());
      this.update(entry.task.id, 'succeeded');
    }).catch((error: Error) => {
      if (!signal.signal.aborted && !this.stopped) this.update(entry.task.id, 'failed', error.message);
    }).finally(() => { this.running = null; if (!this.stopped) this.pump(); });
  }

  onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    this.queue.length = 0;
    this.running?.signal.abort();
    this.changes.complete();
    return (this.running ? this.provider.cancel(this.running.task.id) : Promise.resolve()).then(() => this.work);
  }
}
