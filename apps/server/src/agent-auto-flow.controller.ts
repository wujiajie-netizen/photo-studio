import { Controller, Get, Inject, Param, ParseUUIDPipe, Post, Sse, type MessageEvent } from '@nestjs/common';
import { concat, filter, map, merge, of, type Observable } from 'rxjs';
import { AgentAutoFlowService } from './agent-auto-flow.service';
import { AgentExecutionService } from './agent-execution.service';
import { AgentService } from './agent.service';

@Controller('agent')
export class AgentAutoFlowController {
  constructor(@Inject(AgentAutoFlowService) private readonly flows: AgentAutoFlowService, @Inject(AgentExecutionService) private readonly executions: AgentExecutionService, @Inject(AgentService) private readonly agent: AgentService) {}
  @Get('sessions/:id/flows') list(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.flows.list(id); }
  @Post('tasks/:id/flow/cancel') cancel(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.flows.cancel(id); }
  @Post('tasks/:id/flow/retry') retry(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.flows.retry(id); }
  @Sse('sessions/:id/flow/events') events(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Observable<MessageEvent> {
    const flows = this.flows.list(id).map(flow => ({ type: 'flow', data: flow }));
    const executions = this.agent.tasks(id).flatMap(task => this.executions.list(task.id)).map(execution => ({ type: 'execution', data: execution }));
    return concat(of(...flows, ...executions), merge(
      this.flows.changes.pipe(filter(flow => flow.sessionId === id), map(flow => ({ type: 'flow', data: flow }))),
      this.executions.changes.pipe(filter(execution => execution.sessionId === id), map(execution => ({ type: 'execution', data: execution })))
    ));
  }
}
