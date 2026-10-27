import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CodexModelService } from '../dist/codex-model.service.js';

test('Codex model settings follow the CLI default and persist an explicit available selection', () => {
  let saved = null;
  let catalog = [
    { id: 'gpt-new', displayName: 'GPT New', description: '最新模型', isDefault: true },
    { id: 'gpt-stable', displayName: 'GPT Stable', description: '稳定模型', isDefault: false }
  ];
  const service = new CodexModelService(() => saved, model => { saved = model; }, () => Promise.resolve(catalog));
  return service.settings(true).then(settings => {
    assert.equal(settings.defaultModel, 'gpt-new'); assert.equal(settings.selectedModel, 'gpt-new');
    return service.select('gpt-stable');
  }).then(settings => {
    assert.equal(saved, 'gpt-stable'); assert.equal(settings.selectedModel, 'gpt-stable');
    return service.selected();
  }).then(model => {
    assert.equal(model, 'gpt-stable');
    return service.select('gpt-new');
  }).then(() => {
    assert.equal(saved, null);
    catalog = [{ id: 'gpt-next', displayName: 'GPT Next', description: '下一代模型', isDefault: true }];
    return service.settings(true);
  }).then(settings => {
    assert.equal(settings.selectedModel, 'gpt-next');
    return assert.rejects(service.select('gpt-removed'), /当前提供/);
  });
});
