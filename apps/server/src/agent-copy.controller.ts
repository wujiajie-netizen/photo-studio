import { Controller, Get, Inject, Param, ParseUUIDPipe, Post, Sse, type MessageEvent } from '@nestjs/common';
import { concat, filter, map, of, type Observable } from 'rxjs';
import { AgentCopyService } from './agent-copy.service';

@Controller('agent/executions')
export class AgentCopyController {
  constructor(@Inject(AgentCopyService) private readonly copies: AgentCopyService) {}

  @Get(':id/copy') get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.copies.get(id); }
  @Post(':id/copy/retry') retry(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.copies.retry(id); }
  @Sse(':id/copy/events') events(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Observable<MessageEvent> {
    return concat(of(this.copies.get(id)), this.copies.changes.pipe(filter(copy => copy.executionId === id))).pipe(map(copy => ({ type: 'copy', data: copy })));
  }
}
