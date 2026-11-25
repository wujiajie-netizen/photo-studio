import { ConflictException, Inject, Injectable, NotFoundException, type OnApplicationShutdown } from '@nestjs/common';
import { Subject, type Subscription } from 'rxjs';
import type { AgentAutoFlow, AgentExecution, AgentTask } from '@photo-studio/shared';
import { AgentService } from './agent.service';
import { AgentExecutionService } from './agent-execution.service';
import { StorageService } from './storage.service';

const columns = 'f.plan_task_id AS taskId, t.session_id AS sessionId, f.source_asset_id AS sourceAssetId, f.project_id AS projectId, f.status, f.error, f.execution_id AS executionId';

@Injectable()
export class AgentAutoFlowService implements OnApplicationShutdown {
  readonly changes = new Subject<AgentAutoFlow>();
  private readonly subscriptions: Subscription[];
  private readonly preparations = new Map<string, AbortController>();
  private stopped = false;

  constructor(@Inject(StorageService) private readonly storage: StorageService, @Inject(AgentService) private readonly agent: AgentService, @Inject(AgentExecutionService) private readonly executions: AgentExecutionService) {
    /* 中断的自动准备不自动重新发起模型调用；执行任务由执行器恢复为失败。 */
    storage.database.prepare("UPDATE agent_auto_flows SET status = 'failed', error = ? WHERE status IN ('planning', 'preparing', 'executing')").run('服务已重新启动，任务已中断，请手动重试。');
    this.subscriptions = [agent.changes.subscribe(task => this.onTask(task)), executions.changes.subscribe(execution => this.onExecution(execution))];
    storage.beforeClose.push(() => this.onApplicationShutdown());
  }

  list(sessionId: string): AgentAutoFlow[] {
    this.agent.session(sessionId);
    return this.storage.database.prepare(`SELECT ${columns} FROM agent_auto_flows f JOIN agent_tasks t ON t.id = f.plan_task_id WHERE t.session_id = ? ORDER BY t.created_at, t.rowid`).all(sessionId) as unknown as AgentAutoFlow[];
  }

  flow(taskId: string): AgentAutoFlow {
    this.agent.task(taskId);
    const row = this.storage.database.prepare(`SELECT ${columns} FROM agent_auto_flows f JOIN agent_tasks t ON t.id = f.plan_task_id WHERE t.id = ?`).get(taskId);
    if (!row) throw new NotFoundException('自动创作任务不存在。');
    return row as unknown as AgentAutoFlow;
  }

  private update(taskId: string, status: AgentAutoFlow['status'], error: string | null, executionId?: string | null) {
    const flow = this.flow(taskId);
    this.storage.database.prepare('UPDATE agent_auto_flows SET status = ?, error = ?, execution_id = ? WHERE plan_task_id = ?').run(status, error, executionId === undefined ? flow.executionId : executionId, taskId);
    const saved = this.flow(taskId); this.changes.next(saved); return saved;
  }

  private onTask(task: AgentTask) {
    const row = this.storage.database.prepare('SELECT status FROM agent_auto_flows WHERE plan_task_id = ?').get(task.id);
    if (!row || row.status !== 'planning') return;
    if (task.status === 'queued' || task.status === 'running') { this.changes.next(this.flow(task.id)); return; }
    if (task.status === 'failed' || task.status === 'cancelled') { this.update(task.id, task.status, task.error); return; }
    const result = this.agent.result(task.id);
    if (result.questions.length || !result.plan.some(step => step.tool)) { this.update(task.id, 'clarifying', null); return; }
    this.prepare(task.id);
  }

  private onExecution(execution: AgentExecution) {
    const row = this.storage.database.prepare('SELECT status, execution_id FROM agent_auto_flows WHERE plan_task_id = ?').get(execution.planTaskId);
    if (!row) return;
    /* 新执行或明确重试接管状态，旧执行的迟到事件不能覆盖新执行。 */
    const current = row.execution_id === execution.id;
    const first = row.execution_id === null && row.status === 'preparing';
    const retry = execution.status === 'queued' && ['failed', 'cancelled'].includes(row.status as string);
    if (!current && !first && !retry) return;
    const status = execution.status === 'queued' || execution.status === 'running' ? 'executing' : execution.status;
    this.update(execution.planTaskId, status, execution.error, execution.id);
  }

  private prepare(taskId: string) {
    const changed = this.storage.database.prepare("UPDATE agent_auto_flows SET status = 'preparing', error = NULL WHERE plan_task_id = ? AND status = 'planning'").run(taskId);
    if (!changed.changes) return;
    const flow = this.flow(taskId); this.changes.next(flow);
    const signal = new AbortController(); this.preparations.set(taskId, signal);
    /* 参数补全由服务端独立完成，刷新页面不会重复提交或中断此流程。 */
    Promise.resolve().then(() => this.executions.parameters(taskId, { sourceAssetId: flow.sourceAssetId }, signal.signal)).then(parameters => {
      if (signal.signal.aborted || this.stopped || this.flow(taskId).status !== 'preparing') return;
      this.executions.submit({ planTaskId: taskId, projectId: flow.projectId, steps: parameters.steps });
    }).catch((error: Error) => {
      if (!signal.signal.aborted && !this.stopped && this.flow(taskId).status === 'preparing') this.update(taskId, 'failed', error.message);
    }).finally(() => { if (this.preparations.get(taskId) === signal) this.preparations.delete(taskId); });
  }

  cancel(taskId: string): AgentAutoFlow {
    const flow = this.flow(taskId);
    if (!['planning', 'preparing', 'executing'].includes(flow.status)) return flow;
    const saved = this.update(taskId, 'cancelled', null);
    if (flow.status === 'planning') this.agent.cancel(taskId);
    else if (flow.status === 'preparing') this.preparations.get(taskId)?.abort();
    else if (flow.executionId) this.executions.cancel(flow.executionId);
    return saved;
  }

  retry(taskId: string): AgentAutoFlow {
    const flow = this.flow(taskId);
    if (!['failed', 'cancelled'].includes(flow.status) || flow.executionId || this.agent.task(taskId).status !== 'succeeded') throw new ConflictException('当前任务无法重新整理，请重新发送需求或重试已有执行。');
    if (this.preparations.has(taskId)) throw new ConflictException('上一次参数整理正在停止，请稍后重试。');
    this.update(taskId, 'planning', null);
    this.prepare(taskId);
    return this.flow(taskId);
  }

  onApplicationShutdown(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.stopped = true;
    for (const signal of this.preparations.values()) signal.abort();
    this.subscriptions.forEach(subscription => subscription.unsubscribe());
    this.changes.complete();
    return Promise.resolve();
  }
}
