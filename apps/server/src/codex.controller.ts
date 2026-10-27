import { BadRequestException, Body, Controller, Get, Inject, Patch } from '@nestjs/common';
import { inspectCodex } from '@photo-studio/ai-provider';
import type { CodexModelSettings, CodexStatus } from '@photo-studio/shared';
import { CodexModelService } from './codex-model.service';

@Controller('codex')
export class CodexController {
  private inspection: Promise<CodexStatus> | null = null;
  constructor(@Inject(CodexModelService) private readonly models: CodexModelService) {}

  @Get('status')
  status(): Promise<CodexStatus> {
    /* 多个页面同时检查时共用本次检测；完成后允许下一次刷新读取新的登录状态。 */
    if (!this.inspection) this.inspection = inspectCodex().finally(() => { this.inspection = null; });
    return this.inspection;
  }

  @Get('models')
  listModels(): Promise<CodexModelSettings> {
    return this.models.settings(true);
  }

  @Patch('model')
  selectModel(@Body() input: unknown): Promise<CodexModelSettings> {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || typeof (input as { model?: unknown }).model !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test((input as { model: string }).model)) throw new BadRequestException('请选择有效的 Codex 模型。');
    return this.models.select((input as { model: string }).model).catch(error => {
      if (error instanceof Error && error.message === '请选择 Codex 当前提供的模型。') throw new BadRequestException(error.message);
      throw error;
    });
  }
}
