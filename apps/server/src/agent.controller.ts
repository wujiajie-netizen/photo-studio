import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Sse, type MessageEvent } from '@nestjs/common';
import { concat, filter, map, of, type Observable } from 'rxjs';
import { AgentService } from './agent.service';

@Controller('agent')
export class AgentController {
  constructor(@Inject(AgentService) private readonly agent: AgentService) {}

  @Get('sessions') list() { return this.agent.list(); }
  @Post('sessions') create(@Body('content') content: unknown) { return this.agent.submit(content); }
  @Get('sessions/:id') session(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.agent.session(id); }
  @Get('sessions/:id/messages') messages(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.agent.messages(id); }
  @Get('sessions/:id/tasks') tasks(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.agent.tasks(id); }
  @Post('sessions/:id/messages') submit(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body('content') content: unknown) { return this.agent.submit(content, id); }
  @Get('tasks/:id') task(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.agent.task(id); }
  @Get('tasks/:id/result') result(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.agent.result(id); }
  @Post('tasks/:id/cancel') cancel(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.agent.cancel(id); }

  @Sse('sessions/:id/events')
  events(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Observable<MessageEvent> {
    /* 首次连接和自动重连都发送已持久化任务快照，再接续更新，刷新无需依赖旧事件编号。 */
    return concat(of(...this.agent.tasks(id)), this.agent.changes.pipe(filter((task) => task.sessionId === id)))
      .pipe(map((task) => ({ type: 'task', data: task })));
  }
}
