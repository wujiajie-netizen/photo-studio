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
