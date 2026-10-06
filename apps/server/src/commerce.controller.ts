import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, Req, Sse, StreamableFile, BadRequestException, type MessageEvent } from '@nestjs/common';
import type { Request } from 'express';
import { concat, filter, map, of, type Observable } from 'rxjs';
import type { CommerceKind } from '@photo-studio/shared';
import { CommerceService } from './commerce.service';

@Controller('commerce')
export class CommerceController {
  constructor(@Inject(CommerceService) private readonly commerce: CommerceService) {}
  @Get('tasks') list(@Query('kind') kind: string) { return this.commerce.list(this.kind(kind)); }
  @Post('tasks/:kind') submit(@Param('kind') kind: string, @Body() parameters: unknown) { return this.commerce.submit(this.kind(kind), parameters); }
  @Get('tasks/:id') task(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.commerce.task(id); }
  @Get('tasks/:id/results') results(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.commerce.results(id); }
  @Post('tasks/:id/cancel') cancel(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.commerce.cancel(id); }
  @Post('tasks/:id/retry') retry(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.commerce.retry(id); }
  @Post('tasks/:id/items/:itemId/retry') retryItem(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string) { return this.commerce.retry(id, itemId); }
  @Get('tasks/:id/export') export(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Query('format') format: string) {
    if (format !== 'zip' && format !== 'long') throw new BadRequestException('请选择 ZIP 或长图导出。');
    return this.commerce.export(id, format).then((data) => new StreamableFile(data, { type: format === 'zip' ? 'application/zip' : 'image/png', disposition: `attachment; filename="${format === 'zip' ? 'product-kit.zip' : 'detail-page.png'}"` }));
  }
  @Post('assist') assist(@Body() parameters: unknown, @Req() request: Request) {
    const signal = new AbortController(); const abort = () => signal.abort();
    request.res?.once('close', abort);
    return this.commerce.assist(parameters, signal.signal).finally(() => { request.res?.off('close', abort); });
  }
  @Sse('tasks/:id/events') events(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Observable<MessageEvent> {
    return concat(of(this.commerce.task(id)), this.commerce.changes.pipe(filter((task) => task.id === id))).pipe(map((task) => ({ type: 'task', data: task })));
  }
  private kind(value: string): CommerceKind {
    if (value !== 'product-kit' && value !== 'detail-page') throw new BadRequestException('生成流程无效。');
    return value;
  }
}
