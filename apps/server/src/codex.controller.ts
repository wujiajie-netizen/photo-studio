import { Controller, Get } from '@nestjs/common';
import { inspectCodex } from '@photo-studio/ai-provider';
import type { CodexStatus } from '@photo-studio/shared';

@Controller('codex')
export class CodexController {
  private inspection: Promise<CodexStatus> | null = null;

  @Get('status')
  status(): Promise<CodexStatus> {
    /* 多个页面同时检查时共用本次检测；完成后允许下一次刷新读取新的登录状态。 */
    if (!this.inspection) this.inspection = inspectCodex().finally(() => { this.inspection = null; });
    return this.inspection;
  }
}
