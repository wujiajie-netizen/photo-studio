import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Res, Sse, StreamableFile, UploadedFile, UseInterceptors, type MessageEvent } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'node:fs';
import type { Response } from 'express';
import { concat, filter, map, of, type Observable } from 'rxjs';
import { PRODUCT_UPLOAD_LIMIT } from '@photo-studio/shared';
import { ProductImageService } from './product-image.service';

@Controller()
export class ProductImageController {
  constructor(@Inject(ProductImageService) private readonly images: ProductImageService) {}
  @Get('assets') assets() { return this.images.assets(); }
  @Post('assets')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PRODUCT_UPLOAD_LIMIT, files: 1, fields: 1 } }))
  upload(@UploadedFile() file: Express.Multer.File | undefined, @Body('name') name: unknown) { return this.images.upload(file?.buffer, name); }
  @Get('assets/:id') asset(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.images.asset(id); }
  @Get('assets/:id/file') assetFile(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return new StreamableFile(createReadStream(this.images.assetFile(id)), { type: 'image/png' }); }
  @Get('product-image/tasks') list() { return this.images.list(); }
  @Post('product-image/tasks') submit(@Body() parameters: unknown) { return this.images.submit(parameters); }
  @Get('product-image/tasks/:id') task(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.images.task(id); }
  @Get('product-image/tasks/:id/results') results(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.images.results(id); }
  @Post('product-image/tasks/:id/cancel') cancel(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.images.cancel(id); }
  @Post('product-image/tasks/:id/retry') retry(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.images.retry(id); }
  @Post('product-image/results/:id/retry') retryResult(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.images.retryResult(id); }
  @Get('product-image/results/:id') result(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.images.result(id); }
  @Patch('product-image/results/:id') save(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body('projectId') projectId: unknown) { return this.images.save(id, projectId); }
  @Get('projects/:id/results') projectResults(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.images.projectResults(id); }
  @Get('product-image/results/:id/file')
  file(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Query('download') download: string | undefined, @Res({ passthrough: true }) response: Response) {
    const result = this.images.result(id);
    const path = this.images.resultFile(id);
    response.setHeader('Content-Disposition', `${download === '1' ? 'attachment' : 'inline'}; filename="product-image.png"; filename*=UTF-8''${encodeURIComponent(result.name)}`);
    return new StreamableFile(createReadStream(path), { type: 'image/png' });
  }
  @Sse('product-image/tasks/:id/events')
  events(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Observable<MessageEvent> {
    return concat(of(this.images.task(id)), this.images.changes.pipe(filter((task) => task.id === id))).pipe(map((task) => ({ type: 'task', data: task })));
  }
}
