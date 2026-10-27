import { listCodexModels } from '@photo-studio/ai-provider';
import type { CodexModelOption, CodexModelSettings } from '@photo-studio/shared';

export class CodexModelService {
  private catalog: CodexModelOption[] = [];
  private checkedAt = 0;
  private loading: Promise<CodexModelOption[]> | null = null;

  constructor(
    private readonly readModel: () => string | null = () => null,
    private readonly writeModel: (model: string | null) => void = () => {},
    private readonly loadModels: () => Promise<CodexModelOption[]> = listCodexModels
  ) {}

  settings(refresh = false): Promise<CodexModelSettings> {
    /* 页面刷新强制读取目录；任务侧短时复用，避免每次调用都启动一个 app-server。 */
    let current: Promise<CodexModelOption[]>;
    if (!refresh && this.catalog.length && Date.now() - this.checkedAt < 5 * 60 * 1000) current = Promise.resolve(this.catalog);
    else {
      if (!this.loading) this.loading = this.loadModels()
        .then(models => { this.catalog = models; this.checkedAt = Date.now(); return models; })
        .finally(() => { this.loading = null; });
      current = this.loading;
    }
    return current.then(models => {
      const defaultModel = (models.find(model => model.isDefault) ?? models[0]).id;
      const saved = this.readModel();
      return { models, defaultModel, selectedModel: models.some(model => model.id === saved) ? saved! : defaultModel };
    });
  }

  select(model: string): Promise<CodexModelSettings> {
    return this.settings(true).then(settings => {
      if (!settings.models.some(option => option.id === model)) throw new Error('请选择 Codex 当前提供的模型。');
      this.writeModel(model === settings.defaultModel ? null : model);
      return { ...settings, selectedModel: model };
    });
  }

  selected(): Promise<string> {
    return this.settings().then(settings => settings.selectedModel);
  }
}
