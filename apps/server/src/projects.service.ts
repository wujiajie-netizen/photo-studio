import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { getProjectNameError, type AgentExecutionStep, type CommerceTask, type CreationScene, type EditorLayer, type Project, type ProjectCreationContext } from '@photo-studio/shared';
import { StorageService } from './storage.service';

const columns = 'id, name, created_at AS createdAt, updated_at AS updatedAt';

@Injectable()
export class ProjectsService {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  list(): Project[] {
    return this.storage.database.prepare(`SELECT ${columns} FROM projects ORDER BY updated_at DESC, id ASC`).all() as unknown as Project[];
  }

  findOne(id: string): Project {
    const project = this.storage.database.prepare(`SELECT ${columns} FROM projects WHERE id = ?`).get(id);
    if (!project) throw new NotFoundException('项目不存在。');
    return project as unknown as Project;
  }

  create(input: unknown): Project {
    const name = this.normalizeName(input);
    const timestamp = new Date().toISOString();
    const project: Project = { id: randomUUID(), name, createdAt: timestamp, updatedAt: timestamp };
    this.storage.database.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(project.id, project.name, project.createdAt, project.updatedAt);
    return project;
  }

  creation(id: string, resultId: unknown): ProjectCreationContext {
    const project = this.findOne(id); const database = this.storage.database;
    if (resultId !== undefined && resultId !== null && (typeof resultId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(resultId))) throw new BadRequestException('作品编号无效。');
    const results = database.prepare(`SELECT id, task_id FROM product_image_results WHERE project_id = ?
      UNION ALL SELECT id, task_id FROM commerce_results WHERE project_id = ?
      UNION ALL SELECT id, task_id FROM image_tool_results WHERE project_id = ?`).all(id, id, id);
    const result = results.find(row => row.id === resultId);
    if (resultId && !result) throw new NotFoundException('作品不属于当前项目。');
    const taskIds = new Set(results.map(row => row.task_id));
    const executions = database.prepare('SELECT session_id, project_id, steps FROM agent_executions').all().map(row => ({ session_id: row.session_id, project_id: row.project_id, steps: JSON.parse(row.steps as string) as AgentExecutionStep[] }));
    const tools = database.prepare('SELECT id, session_id, result_id FROM image_tool_tasks').all();
    const sessions = database.prepare('SELECT id, project_id FROM agent_sessions WHERE deleted_at IS NULL ORDER BY updated_at DESC, rowid DESC').all();
    /* 单图优先恢复来源对话；其次恢复最近相关对话，没有可恢复记录时创建空白会话，绝不重跑模型。 */
    const source = result && sessions.find(session => executions.some(execution => execution.session_id === session.id && execution.steps.some(step => step.taskId === result.task_id)) || tools.some(tool => tool.session_id === session.id && tool.id === result.task_id));
    const recent = sessions.find(session => session.project_id === id || executions.some(execution => execution.session_id === session.id && (execution.project_id === id || execution.steps.some(step => taskIds.has(step.taskId)))) || tools.some(tool => tool.session_id === session.id && (taskIds.has(tool.id) || results.some(item => item.id === tool.result_id))));
    const sessionId = (source?.id ?? recent?.id ?? randomUUID()) as string;
    if (source || recent) database.prepare('UPDATE agent_sessions SET project_id = ? WHERE id = ?').run(id, sessionId);
    else { const now = new Date().toISOString(); database.prepare('INSERT INTO agent_sessions (id, title, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(sessionId, project.name, id, now, now); }
    return { sessionId, projectId: id, resultId: typeof resultId === 'string' ? resultId : null };
  }

  rename(id: string, input: unknown): Project {
    const name = this.normalizeName(input);
    const project = this.findOne(id);
    const updatedAt = new Date().toISOString();
    this.storage.database.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(name, updatedAt, id);
    return { ...project, name, updatedAt };
  }

  remove(id: string): { id: string } {
    const database = this.storage.database;
    database.exec('BEGIN IMMEDIATE');
    try { this.removeProject(id); database.exec('COMMIT'); }
    catch (error) { database.exec('ROLLBACK'); throw error; }
    return { id };
  }

  private removeProject(id: string) {
    const database = this.storage.database;
    /* 按执行记录定位关联对话，先检查共享项目与活动任务，再原子删除项目、作品和整段对话。 */
    this.findOne(id);
    const results = database.prepare(`SELECT id, task_id, project_id FROM product_image_results
      UNION ALL SELECT id, task_id, project_id FROM commerce_results
      UNION ALL SELECT id, task_id, project_id FROM image_tool_results`).all();
    const projectTasks = new Set(results.filter(row => row.project_id === id).map(row => row.task_id));
    const executions = database.prepare('SELECT session_id, project_id, steps FROM agent_executions').all();
    const tools = database.prepare('SELECT id, session_id FROM image_tool_tasks').all();
    const sessions = new Set(executions.filter(row => row.project_id === id || (JSON.parse(row.steps as string) as AgentExecutionStep[]).some(step => projectTasks.has(step.taskId))).map(row => row.session_id));
    database.prepare('SELECT id FROM agent_sessions WHERE project_id = ?').all(id).forEach(row => sessions.add(row.id));
    tools.forEach(row => { if (projectTasks.has(row.id)) sessions.add(row.session_id); });
    if (executions.some(row => sessions.has(row.session_id) && row.project_id !== id)) throw new ConflictException('关联对话同时属于其他项目，请先处理其他关联项目，避免删除其创作记录。');
    const taskIds = new Set<string>();
    executions.filter(row => sessions.has(row.session_id)).forEach(row => (JSON.parse(row.steps as string) as AgentExecutionStep[]).forEach(step => { if (step.taskId) taskIds.add(step.taskId); }));
    tools.filter(row => sessions.has(row.session_id)).forEach(row => taskIds.add(row.id as string));
    if (results.some(row => taskIds.has(row.task_id as string) && row.project_id !== null && row.project_id !== id)) throw new ConflictException('关联对话的图片已保存到其他项目，请先处理这些图片后再删除。');
    const resultIds = new Set(results.filter(row => row.project_id === id || taskIds.has(row.task_id as string)).map(row => row.id as string));
    for (const table of ['agent_tasks', 'agent_executions', 'image_tool_tasks']) {
      if (database.prepare(`SELECT session_id FROM ${table} WHERE status IN ('queued', 'running')`).all().some(row => sessions.has(row.session_id))) throw new ConflictException('关联对话仍有进行中的任务，请等待完成或停止后再删除。');
    }
    this.removeResults(resultIds);
    database.prepare('UPDATE editor_documents SET project_id = NULL WHERE project_id = ?').run(id);
    database.prepare('DELETE FROM agent_executions WHERE project_id = ?').run(id);
    for (const sessionId of sessions) {
      for (const table of ['image_tool_tasks', 'creation_scenes', 'agent_messages', 'agent_tasks']) database.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(sessionId);
      database.prepare('DELETE FROM agent_sessions WHERE id = ?').run(sessionId);
    }
    for (const taskId of taskIds) {
      database.prepare('DELETE FROM product_image_tasks WHERE id = ?').run(taskId);
      database.prepare('DELETE FROM commerce_tasks WHERE id = ?').run(taskId);
    }
    database.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  removeResult(projectId: string, resultId: string, deleteProjectWhenEmpty: unknown): { id: string; projectDeleted: boolean } {
    if (deleteProjectWhenEmpty !== undefined && typeof deleteProjectWhenEmpty !== 'boolean') throw new BadRequestException('项目删除确认必须为布尔值。');
    const database = this.storage.database;
    let projectDeleted = false;
    database.exec('BEGIN IMMEDIATE');
    /* 在事务内重新计数；最后一张必须明确确认，避免其他窗口删图后静默扩大删除范围。 */
    try {
      this.findOne(projectId);
      const result = database.prepare(`SELECT id FROM product_image_results WHERE id = ? AND project_id = ?
        UNION ALL SELECT id FROM commerce_results WHERE id = ? AND project_id = ?
        UNION ALL SELECT id FROM image_tool_results WHERE id = ? AND project_id = ?`).get(resultId, projectId, resultId, projectId, resultId, projectId);
      if (!result) throw new NotFoundException('项目内的图片不存在。');
      const remaining = database.prepare(`SELECT id FROM product_image_results WHERE project_id = ?
        UNION ALL SELECT id FROM commerce_results WHERE project_id = ?
        UNION ALL SELECT id FROM image_tool_results WHERE project_id = ?`).all(projectId, projectId, projectId);
      if (remaining.length === 1) {
        if (deleteProjectWhenEmpty !== true) throw new ConflictException('当前项目只剩最后一张图片，删除后项目及关联对话也会一起删除，请重新确认。');
        this.removeProject(projectId); projectDeleted = true;
      } else {
        this.removeResults(new Set([resultId]));
        database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), projectId);
      }
      database.exec('COMMIT');
    } catch (error) { database.exec('ROLLBACK'); throw error; }
    return { id: resultId, projectDeleted };
  }

  private removeResults(ids: Set<string>) {
    const database = this.storage.database;
    const results = database.prepare('SELECT id, task_id FROM product_image_results UNION ALL SELECT id, task_id FROM commerce_results UNION ALL SELECT id, task_id FROM image_tool_results').all();
    const tasks = new Set(results.filter(row => ids.has(row.id as string)).map(row => row.task_id));
    const active = ['product_image_tasks', 'commerce_tasks', 'image_tool_tasks'].some(table => database.prepare(`SELECT id FROM ${table} WHERE status IN ('queued', 'running')`).all().some(row => tasks.has(row.id)))
      || database.prepare(`SELECT result_id FROM image_tool_tasks WHERE status IN ('queued', 'running')`).all().some(row => ids.has(row.result_id as string))
      || database.prepare(`SELECT steps FROM agent_executions WHERE status IN ('queued', 'running')`).all().some(row => (JSON.parse(row.steps as string) as AgentExecutionStep[]).some(step => tasks.has(step.taskId)));
    if (active) throw new ConflictException('图片仍有进行中的任务，请等待完成或停止后再删除。');
    for (const row of database.prepare('SELECT result_id, layers FROM editor_documents').all()) {
      if (!ids.has(row.result_id as string) && (JSON.parse(row.layers as string) as EditorLayer[]).some(layer => layer.type === 'image' && ids.has(layer.resultId))) throw new ConflictException('其他作品正在引用这张图片，请先移除引用后再删除。');
    }
    const now = new Date().toISOString();
    for (const row of database.prepare('SELECT session_id, boards, selected_id FROM creation_scenes').all()) {
      const original = JSON.parse(row.boards as string) as CreationScene['boards'];
      const boards = original.filter(board => !ids.has(board.resultId));
      if (boards.length !== original.length) database.prepare('UPDATE creation_scenes SET boards = ?, selected_id = ?, revision = revision + 1, updated_at = ? WHERE session_id = ?').run(JSON.stringify(boards), ids.has(row.selected_id as string) ? null : row.selected_id, now, row.session_id);
    }
    for (const row of database.prepare('SELECT id, output_result_ids, output_layers FROM image_tool_tasks').all()) {
      const original = JSON.parse(row.output_result_ids as string) as string[];
      const remaining = original.filter(id => !ids.has(id));
      if (remaining.length !== original.length) database.prepare('UPDATE image_tool_tasks SET output_result_ids = ?, output_layers = ? WHERE id = ?').run(JSON.stringify(remaining), JSON.stringify((JSON.parse(row.output_layers as string) as EditorLayer[]).filter(layer => layer.type !== 'image' || !ids.has(layer.resultId))), row.id);
    }
    for (const row of database.prepare('SELECT id, items FROM commerce_tasks').all()) {
      const items = JSON.parse(row.items as string) as CommerceTask['items'];
      if (items.some(item => item.resultId && ids.has(item.resultId))) database.prepare('UPDATE commerce_tasks SET items = ? WHERE id = ?').run(JSON.stringify(items.map(item => item.resultId && ids.has(item.resultId) ? { ...item, resultId: null } : item)), row.id);
    }
    for (const id of ids) {
      database.prepare('DELETE FROM editor_documents WHERE result_id = ?').run(id);
      for (const table of ['product_image_results', 'commerce_results', 'image_tool_results']) database.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    }
  }

  private normalizeName(input: unknown): string {
    const error = getProjectNameError(input);
    if (error) throw new BadRequestException(error);
    return (input as string).trim();
  }
}
