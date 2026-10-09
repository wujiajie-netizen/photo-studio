import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { validateBrandPresetInput, validateCreationPresetInput, type BrandPreset, type CreationPreset, type CreationPresetInput } from '@photo-studio/shared';
import { StorageService } from './storage.service';

@Injectable()
export class PresetsService {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  brands(): BrandPreset[] {
    return this.storage.database.prepare('SELECT id, name, style, created_at AS createdAt, updated_at AS updatedAt FROM brand_presets ORDER BY updated_at DESC, id').all()
      .map(({ style, ...preset }) => ({ ...preset, ...JSON.parse(style as string) })) as BrandPreset[];
  }

  saveBrand(input: unknown, id?: string): BrandPreset {
    let value;
    try { value = validateBrandPresetInput(input); } catch (error) { throw new BadRequestException((error as Error).message); }
    const saved = id ? this.brands().find(preset => preset.id === id) : null;
    if (id && !saved) throw new NotFoundException('品牌预设不存在。');
    const { name, ...style } = value;
    const now = new Date().toISOString();
    const preset: BrandPreset = { ...style, id: id || randomUUID(), name, createdAt: saved?.createdAt || now, updatedAt: now };
    this.storage.database.prepare('INSERT INTO brand_presets VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, style = excluded.style, updated_at = excluded.updated_at')
      .run(preset.id, name, JSON.stringify(style), preset.createdAt, now);
    return preset;
  }

  removeBrand(id: string): void {
    if (!this.storage.database.prepare('DELETE FROM brand_presets WHERE id = ?').run(id).changes) throw new NotFoundException('品牌预设不存在。');
  }

  creations(kind?: CreationPresetInput['kind']): CreationPreset[] {
    return this.storage.database.prepare(`SELECT id, name, kind, parameters, created_at AS createdAt, updated_at AS updatedAt FROM creation_presets ${kind ? 'WHERE kind = ?' : ''} ORDER BY updated_at DESC, id`).all(...(kind ? [kind] : []))
      .map(({ parameters, ...preset }) => ({ ...preset, parameters: JSON.parse(parameters as string) })) as CreationPreset[];
  }

  saveCreation(input: unknown, id?: string): CreationPreset {
    let value;
    try { value = validateCreationPresetInput(input); } catch (error) { throw new BadRequestException((error as Error).message); }
    const saved = id ? this.creations().find(preset => preset.id === id) : null;
    if (id && !saved) throw new NotFoundException('创作方案不存在。');
    if (saved && saved.kind !== value.kind) throw new BadRequestException('已有方案不能改变功能类型，请另存方案。');
    const now = new Date().toISOString();
    const preset: CreationPreset = { ...value, id: id || randomUUID(), createdAt: saved?.createdAt || now, updatedAt: now };
    /* 保存参数快照；应用预设不会自动生成，历史任务也不反查会变化的品牌预设。 */
    this.storage.database.prepare('INSERT INTO creation_presets VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, parameters = excluded.parameters, updated_at = excluded.updated_at')
      .run(preset.id, preset.name, preset.kind, JSON.stringify(preset.parameters), preset.createdAt, now);
    return preset;
  }

  removeCreation(id: string): void {
    if (!this.storage.database.prepare('DELETE FROM creation_presets WHERE id = ?').run(id).changes) throw new NotFoundException('创作方案不存在。');
  }
}
