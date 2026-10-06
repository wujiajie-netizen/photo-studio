import { Controller, Get, Inject } from '@nestjs/common';
import { ImageEngineService } from './image-engine.service';
@Controller('image-engine')
export class ImageEngineController {
  constructor(@Inject(ImageEngineService) private readonly engine: ImageEngineService) {}
  @Get('status') status() { return this.engine.status(); }
}
