import { Controller, Get, Inject } from '@nestjs/common';
import type { LocalHealth, LocalImageToolsStatus, LocalTaskSummary, TaskStatus } from '@photo-studio/shared';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { StorageService } from './storage.service';

@Controller()
export class AppController {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  @Get('health')
  health(): LocalHealth {
    this.storage.database.prepare('SELECT 1').get();
    return { status: 'ready', storage: 'sqlite', dataDirectory: this.storage.dataDirectory };
  }

  @Get('image-tools/status')
  imageTools(): Promise<LocalImageToolsStatus> {
    const runtime = resolve(process.env.PHOTO_STUDIO_IMAGE_TOOLS_DIR || resolve(__dirname, '../../../data/runtimes/image-tools'));
    const python = resolve(runtime, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    /* 只检查已安装运行环境，不在设置页下载模型或执行收费调用。 */
    return Promise.all([python, ...['ocr-det.onnx', 'ocr-cls.onnx', 'ocr-rec.onnx', 'birefnet.onnx', 'sam2.pt', 'lama.pt'].map(name => resolve(runtime, 'models', name))].map(path => access(path)))
      .then((): LocalImageToolsStatus => ({ status: 'ready', message: '本地图片工具环境与模型文件已就绪。识字和抠图在本地处理；拆层另需 Codex 语义分析，实际效果以任务结果为准。' }))
      .catch((): LocalImageToolsStatus => ({ status: 'missing', message: '本地图片工具环境或模型文件缺失，请运行 scripts/setup-image-tools.ps1 安装后重试。' }));
  }

  @Get('tasks/status')
  tasks(): LocalTaskSummary {
    const tables = [['agent', 'agent_tasks'], ['execution', 'agent_executions'], ['product-image', 'product_image_tasks'], ['commerce', 'commerce_tasks'], ['image-tool', 'image_tool_tasks']] as const;
    return { groups: tables.map(([kind, table]) => {
      const counts: Record<TaskStatus, number> = { queued: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 };
      for (const row of this.storage.database.prepare(`SELECT status, COUNT(*) AS count FROM ${table} GROUP BY status`).all()) counts[row.status as TaskStatus] = row.count as number;
      return { kind, counts };
    }) };
  }
}
