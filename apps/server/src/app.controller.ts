import { Controller, Get, Inject } from '@nestjs/common';
import type { LocalHealth } from '@photo-studio/shared';
import { StorageService } from './storage.service';

@Controller()
export class AppController {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  @Get('health')
  health(): LocalHealth {
    this.storage.database.prepare('SELECT 1').get();
    return { status: 'ready', storage: 'sqlite', dataDirectory: this.storage.dataDirectory };
  }
}
