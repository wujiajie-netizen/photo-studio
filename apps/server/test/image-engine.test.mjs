import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import sharp from 'sharp';
import { ImageGenerationError } from '@photo-studio/ai-provider';
import { ImageEngineService } from '../dist/image-engine.service.js';

test('all scenes use the Codex provider, output fits requested dimensions and cancelled queued work never calls the model', () => {
  const callbacks = []; const calls = []; let release;
  let mode = 'success'; let picture;
  const provider = { generateImage(id, source, prompt, signal) {
    calls.push({ id, source, prompt, signal });
    if (mode === 'hold') return new Promise((done) => { release = done; });
    if (mode === 'quota') return Promise.reject(new ImageGenerationError('Codex 额度受限。'));
    return Promise.resolve(picture);
  } };
  const engine = new ImageEngineService({ beforeClose: callbacks }, provider);
  const parameters = { sourceAssetId: randomUUID(), subject: 'keep', scene: 'white', description: '保持商品标识', ratio: '3:4', count: 1, quality: 'standard' };
  return sharp({ create: { width: 48, height: 64, channels: 4, background: '#663322' } }).png().toBuffer().then((data) => {
    picture = data; return engine.render(data, parameters, 0, new AbortController().signal);
  }).then((result) => {
    assert.equal(calls.length, 1); assert.match(calls[0].prompt, /pure white/); assert.match(calls[0].prompt, /保持商品标识/);
    assert.equal(result.width, 768); assert.equal(result.height, 1024);
    return sharp(result.data).metadata();
  }).then((metadata) => {
    assert.equal(metadata.format, 'png'); assert.equal(metadata.width, 768);
    mode = 'hold'; const firstSignal = new AbortController(); const waitingSignal = new AbortController();
    const first = engine.render(picture, { ...parameters, scene: 'cool', quality: 'high' }, 0, firstSignal.signal);
    const queued = engine.render(picture, { ...parameters, scene: 'warm' }, 0, waitingSignal.signal);
    waitingSignal.abort();
    const wait = () => release ? Promise.resolve() : new Promise(done => setTimeout(done, 1)).then(wait);
    return wait().then(() => { release(picture); return Promise.all([first, assert.rejects(queued, /取消/)]); });
  }).then(([result]) => {
    assert.equal(result.width, 1536); assert.equal(result.height, 2048); assert.equal(calls.length, 2);
    mode = 'success'; return engine.render(null, { ...parameters, sourceAssetId: null, description: '咖啡豆与暖色光线' }, 0, new AbortController().signal);
  }).then(result => {
    assert.equal(calls.at(-1).source, null); assert.match(calls.at(-1).prompt, /No source photo/); assert.match(calls.at(-1).prompt, /咖啡豆与暖色光线/); assert.equal(result.width, 768);
    mode = 'quota'; return assert.rejects(engine.render(picture, parameters, 0, new AbortController().signal), /额度/);
  }).then(() => { assert.equal(callbacks.length, 1); return callbacks[0](); });
});

test('commerce generation receives platform, region, all facts, module role and one brand snapshot', () => {
  const calls = []; let picture;
  const engine = new ImageEngineService({ beforeClose: [] }, { generateImage(id, source, prompt) { calls.push(prompt); return Promise.resolve(picture); } });
  const parameters = { sourceAssetId: null, subject: 'keep', scene: 'warm', description: 'confirmed module facts', ratio: '1:1', count: 1, quality: 'standard' };
  const commerce = { sourceAssetId: null, subject: 'keep', scene: 'warm', ratio: '1:1', quality: 'standard', productName: '商品名称', platform: 'amazon', region: 'US', language: 'en-US', sellingPoints: Array.from({ length: 8 }, (_, index) => `${index}: ${'已确认卖点'.repeat(35)}`), sections: [{ type: 'hero', title: 'Main', content: '包装' }, { type: 'specification', title: 'Specification', content: '净重 200 g' }], brand: { fontFamily: 'Arial', primaryColor: '#123456', textColor: '#654321', backgroundColor: '#abcdef', styleDescription: 'Consistent warm studio lighting' } };
  return sharp({ create: { width: 32, height: 32, channels: 4, background: '#ffffff' } }).png().toBuffer().then(data => {
    picture = data; return engine.render(null, parameters, 0, new AbortController().signal, { parameters: commerce, sectionIndex: 0 });
  }).then(() => engine.render(null, parameters, 0, new AbortController().signal, { parameters: commerce, sectionIndex: 1 })).then(() => {
    assert.equal(calls.length, 2); assert.match(calls[0], /Current module role: hero/); assert.match(calls[1], /Current module role: specification/);
    for (const prompt of calls) {
      assert.ok(prompt.includes(JSON.stringify(commerce))); assert.match(prompt, /Apply the confirmed brand/); assert.match(prompt, /one coherent ecommerce series/); assert.match(prompt, /do not draw them into the generated photo/);
    }
  }).finally(() => engine.onApplicationShutdown());
});

test('cabbage cover keeps requested copy and scene, while plain product photos do not request added copy', () => {
  const prompts = []; let picture;
  const engine = new ImageEngineService({ beforeClose: [] }, { generateImage(_id, _source, prompt) { prompts.push(prompt); return Promise.resolve(picture); } });
  const parameters = { sourceAssetId: null, subject: 'keep', scene: 'cool', description: '大白菜，厨房或菜市场氛围。标题“大白菜到家”，副标题“家常菜少不了这一口”，辅助文字“涮、炒、炖都合适”。', ratio: '9:16', count: 1, quality: 'standard' };
  return sharp({ create: { width: 36, height: 64, channels: 4, background: '#ffffff' } }).png().toBuffer().then(data => {
    picture = data; return engine.render(null, parameters, 0, new AbortController().signal);
  }).then(() => {
    assert.ok(prompts[0].includes(parameters.description));
    assert.doesNotMatch(prompts[0], /Do not add marketing text|will be added as editable text/);
    assert.match(prompts[0], /Generate the requested copy and visual design together in one complete image/);
    assert.match(prompts[0], /only when unspecified, use a cool blue/);
    return engine.render(null, { ...parameters, scene: 'white', description: '白底大白菜商品图，不添加文字。' }, 0, new AbortController().signal);
  }).then(() => {
    assert.match(prompts[1], /If no added text is requested, keep the image free of added marketing text/);
    assert.match(prompts[1], /白底大白菜商品图，不添加文字/);
    assert.doesNotMatch(prompts[1], /previous attempt failed/);
  }).finally(() => engine.onApplicationShutdown());
});
