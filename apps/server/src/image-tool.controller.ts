import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, Sse, type MessageEvent } from '@nestjs/common';
import { concat, filter, from, map, of, type Observable } from 'rxjs';
import { ImageToolService } from './image-tool.service';

@Controller('image-tools/tasks')
export class ImageToolController {
  constructor(@Inject(ImageToolService) private readonly tools: ImageToolService) {}
  @Get() list(@Query('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string) { return this.tools.list(sessionId); }
  @Post() submit(@Body() input: unknown) { return this.tools.submit(input); }
  @Get(':id') task(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.tools.task(id); }
  @Post(':id/cancel') cancel(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.tools.cancel(id); }
  @Post(':id/retry') retry(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.tools.retry(id); }
  @Sse('session/:sessionId/events') sessionEvents(@Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string): Observable<MessageEvent> {
    return concat(from(this.tools.list(sessionId)), this.tools.changes.pipe(filter(task => task.sessionId === sessionId))).pipe(map(task => ({ type: 'task', data: task })));
  }
  @Sse(':id/events') events(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Observable<MessageEvent> {
    return concat(of(this.tools.task(id)), this.tools.changes.pipe(filter(task => task.id === id))).pipe(map(task => ({ type: 'task', data: task })));
  }
}
