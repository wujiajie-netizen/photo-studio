import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import type { CreationPresetInput } from '@photo-studio/shared';
import { PresetsService } from './presets.service';

@Controller()
export class PresetsController {
  constructor(@Inject(PresetsService) private readonly presets: PresetsService) {}
  @Get('brand-presets') brands() { return this.presets.brands(); }
  @Post('brand-presets') createBrand(@Body() input: unknown) { return this.presets.saveBrand(input); }
  @Patch('brand-presets/:id') updateBrand(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() input: unknown) { return this.presets.saveBrand(input, id); }
  @Delete('brand-presets/:id') removeBrand(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { this.presets.removeBrand(id); return { removed: true }; }
  @Get('creation-presets') creations(@Query('kind') kind?: CreationPresetInput['kind']) {
    if (kind !== undefined && !['product-image', 'product-kit', 'detail-page'].includes(kind)) throw new BadRequestException('创作方案类型无效。');
    return this.presets.creations(kind);
  }
  @Post('creation-presets') createCreation(@Body() input: unknown) { return this.presets.saveCreation(input); }
  @Patch('creation-presets/:id') updateCreation(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() input: unknown) { return this.presets.saveCreation(input, id); }
  @Delete('creation-presets/:id') removeCreation(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { this.presets.removeCreation(id); return { removed: true }; }
}
