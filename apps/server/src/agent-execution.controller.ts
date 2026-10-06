import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Res, Sse, type MessageEvent } from '@nestjs/common';
import type { Response } from 'express';
import { concat, filter, map, of, type Observable } from 'rxjs';
import { AgentExecutionService } from './agent-execution.service';

@Controller('agent')
export class AgentExecutionController {
  constructor(@Inject(AgentExecutionService) private readonly executions: AgentExecutionService) {}
  @Get('tasks/:id/executions') list(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.executions.list(id); }
  @Get('tasks/:id/parameters') draft(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.executions.draft(id); }
  @Post('tasks/:id/parameters') parameters(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() input: unknown, @Res({ passthrough: true }) response: Response) {
    const controller = new AbortController(); const cancel = () => controller.abort(); response.on('close', cancel);
    return this.executions.parameters(id, input, controller.signal).finally(() => response.off('close', cancel));
  }
  @Post('executions') submit(@Body() input: unknown) { return this.executions.submit(input); }
  @Get('executions/:id') task(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.executions.task(id); }
  @Post('executions/:id/cancel') cancel(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.executions.cancel(id); }
  @Post('executions/:id/retry') retry(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.executions.retry(id); }
  @Sse('executions/:id/events') events(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Observable<MessageEvent> {
    return concat(of(this.executions.task(id)), this.executions.changes.pipe(filter(task => task.id === id))).pipe(map(task => ({ type: 'execution', data: task })));
  }
}
