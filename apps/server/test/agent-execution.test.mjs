import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import sharp from 'sharp';
import { renderMockProductImage } from '@photo-studio/tools';
import { AgentExecutionService } from '../dist/agent-execution.service.js';
import { AgentExecutionController } from '../dist/agent-execution.controller.js';
import { AgentService, AGENT_MODEL_PROVIDER } from '../dist/agent.service.js';
import { AgentController } from '../dist/agent.controller.js';
import { ProductImageService, PRODUCT_IMAGE_TOOL } from '../dist/product-image.service.js';
import { ProductImageController } from '../dist/product-image.controller.js';
import { CommerceService } from '../dist/commerce.service.js';
import { EditorService } from '../dist/editor.service.js';
import { ProjectsService } from '../dist/projects.service.js';
import { ProjectsController } from '../dist/projects.controller.js';
import { StorageService } from '../dist/storage.service.js';
import { ImageEngineService } from '../dist/image-engine.service.js';

test('Agent executes confirmed tools, observes real images, limits retries, saves passed steps and resumes only unfinished work', () => {
  const directory = mkdtempSync(join(tmpdir(), 'photo-studio-execution-')); const original = process.env.PHOTO_STUDIO_DATA_DIR; process.env.PHOTO_STUDIO_DATA_DIR = directory;
  let app, base, planTaskId, projectId, sourceId, requestBody, failedExecution, completedExecution;
  let renderCalls = 0; let imageChecks = 0; let rejectKit = true; let hold = false; let sourceBytes; let compositionChecks = 0;
  const streams = new Map();
  const provider = { run(input) {
    if (!input.schema.required.includes('approved')) return Readable.from([{ type: 'completed', result: { summary: '咖啡主图与套图计划', questions: [], plan: [{ title: '商品主图', description: '白底保留包装', tool: 'product-image' }, { title: '商品套图', description: '展示咖啡和规格', tool: 'product-kit' }] } }]);
    assert.ok(input.images.length >= 2); assert.ok(input.images.every(Buffer.isBuffer));
    assert.deepEqual(input.images[0], sourceBytes);
    const kit = input.prompt.includes('模块：商品套图'); const approved = kit ? !rejectKit : ++imageChecks > 1;
    if (hold && kit) { const stream = new Readable({ objectMode: true, read() {} }); streams.set(input.taskId, stream); return stream; }
    const checked = kit ? Promise.all(input.images.slice(1).map(image => sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true }).then(({ data, info }) => {
      assert.equal(info.width, 1024); assert.equal(info.height, 1024); assert.deepEqual([...data.subarray(0, 4)], [240, 232, 220, 255]);
      let titlePixels = 0;
      for (let index = 885 * info.width * 4; index < data.length; index += 4) if (data[index] === 204 && data[index + 1] === 0 && data[index + 2] === 68 && data[index + 3] === 255) ++titlePixels;
      assert.ok(titlePixels > 30, '检查图片应包含独立标题文字层，而不是只有生成原图'); ++compositionChecks;
    }))) : Promise.resolve();
    return Readable.from([checked.then(() => ({ type: 'completed', result: { approved, observation: approved ? '商品形态与文字清晰，结果通过检查。' : '局部文字需要重新生成。' } }))]);
  }, cancel(id) { const stream = streams.get(id); if (stream) { stream.push({ type: 'cancelled' }); stream.push(null); streams.delete(id); } return Promise.resolve(); } };
  class TestModule {}
  Module({ controllers: [AgentController, AgentExecutionController, ProductImageController, ProjectsController], providers: [StorageService, ProjectsService, AgentService, ProductImageService, CommerceService, EditorService, AgentExecutionService, { provide: AGENT_MODEL_PROVIDER, useValue: provider }, { provide: PRODUCT_IMAGE_TOOL, useValue: (...args) => { ++renderCalls; return renderMockProductImage(...args); } }] })(TestModule);
  const start = () => NestFactory.create(TestModule, { logger: false }).then(instance => { app = instance; app.setGlobalPrefix('api'); return app.listen(0, '127.0.0.1'); }).then(() => { base = `http://127.0.0.1:${app.getHttpServer().address().port}/api`; });
  const send = (path, body, method = body === undefined ? 'GET' : 'POST') => fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then(response => response.json().then(value => ({ status: response.status, body: value })));
  const wait = (path, status, attempt = 0) => send(path).then(result => { if (result.body.status === status) return result.body; assert.ok(attempt < 300, JSON.stringify(result.body)); return new Promise(done => setTimeout(done, 10)).then(() => wait(path, status, attempt + 1)); });
  return start().then(() => send('/agent/sessions', { content: '制作咖啡主图与套图' })).then(result => { planTaskId = result.body.id; return wait('/agent/tasks/' + planTaskId, 'succeeded'); })
    .then(() => send('/projects', { name: 'Agent 验收' })).then(result => { projectId = result.body.id; return sharp({ create: { width: 70, height: 90, channels: 4, background: '#773311' } }).png().toBuffer(); })
    .then(data => { sourceBytes = data; const form = new FormData(); form.append('file', new Blob([data]), 'source.png'); form.append('name', '原图'); return fetch(base + '/assets', { method: 'POST', body: form }).then(response => response.json()); })
    .then(asset => {
      sourceId = asset.id; sourceBytes = readFileSync(app.get(ProductImageService).assetFile(sourceId));
      requestBody = { planTaskId, projectId, steps: [
        { title: '商品主图', tool: 'product-image', parameters: { sourceAssetId: sourceId, subject: 'keep', scene: 'white', ratio: '1:1', quality: 'standard', count: 1, description: '保留咖啡包装' } },
        { title: '商品套图', tool: 'product-kit', parameters: { sourceAssetId: sourceId, subject: 'keep', scene: 'white', ratio: '1:1', quality: 'standard', productName: '咖啡', platform: 'general', region: 'CN', language: 'zh-CN', sellingPoints: ['净含量 200 克'], sections: [{ type: 'hero', title: '咖啡', content: '商品展示' }, { type: 'specification', title: '规格', content: '净含量 200 克' }], brand: { fontFamily: 'Microsoft YaHei', primaryColor: '#cc0044', textColor: '#202020', backgroundColor: '#f0e8dc', styleDescription: '统一暖色排版' } } }
      ] };
      return send('/agent/executions', { ...requestBody, steps: [{ ...requestBody.steps[0], tool: 'shell' }, requestBody.steps[1]] });
    }).then(result => { assert.equal(result.status, 400); return send('/agent/executions', requestBody); })
    .then(result => { assert.equal(result.status, 201); failedExecution = result.body; return send('/agent/executions', requestBody); })
    .then(result => { assert.equal(result.status, 409); return wait('/agent/executions/' + failedExecution.id, 'failed'); })
    .then(result => {
      failedExecution = result; assert.equal(result.steps[0].status, 'succeeded'); assert.equal(result.steps[0].retryCount, 1); assert.equal(result.steps[1].status, 'failed'); assert.equal(result.steps[1].retryCount, 1); assert.equal(renderCalls, 6);
      return send('/projects/' + projectId + '/results');
    }).then(result => { assert.equal(result.body.length, 1); rejectKit = false; return send('/agent/executions/' + failedExecution.id + '/retry', {}); })
    .then(result => { completedExecution = result.body; assert.equal(completedExecution.steps[0].taskId, failedExecution.steps[0].taskId); return wait('/agent/executions/' + completedExecution.id, 'succeeded'); })
    .then(result => { completedExecution = result; assert.equal(result.progress, 100); assert.equal(renderCalls, 8); assert.equal(compositionChecks, 6); assert.ok(result.steps.every(step => step.status === 'succeeded')); return send('/projects/' + projectId + '/results'); })
    .then(result => { assert.equal(result.body.length, 3); return app.close(); }).then(start)
    .then(() => send('/agent/executions/' + completedExecution.id)).then(result => { assert.deepEqual(result.body, completedExecution); hold = true; return send('/agent/executions', requestBody); })
    .then(result => {
      const id = result.body.id;
      const ready = (attempt = 0) => { if (streams.size) return Promise.resolve(); assert.ok(attempt < 300); return new Promise(done => setTimeout(done, 10)).then(() => ready(attempt + 1)); };
      return ready().then(() => send('/agent/executions/' + id + '/cancel', {})).then(value => { assert.equal(value.body.status, 'cancelled'); assert.equal(streams.size, 0); return new Promise(done => setTimeout(done, 30)).then(() => send('/agent/executions/' + id)); });
    }).then(result => {
      assert.equal(result.body.status, 'cancelled'); assert.equal(result.body.steps[0].status, 'succeeded'); assert.equal(result.body.steps[1].status, 'cancelled');
      const images = app.get(CommerceService).results(result.body.steps[1].taskId); assert.equal(images.length, 2); assert.ok(images.every(image => image.projectId === null));
      return send('/projects/' + projectId + '/results');
    }).then(result => { assert.equal(result.body.length, 4); })
    .finally(() => (app ? app.close() : Promise.resolve()).then(() => { if (original === undefined) delete process.env.PHOTO_STUDIO_DATA_DIR; else process.env.PHOTO_STUDIO_DATA_DIR = original; assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`)); assert.ok(basename(directory).startsWith('photo-studio-execution-')); rmSync(directory, { recursive: true, force: true }); }));
});

test('same-page text creation persists model parameters, creates one project, and uses only generated images for checks', () => {
  const directory = mkdtempSync(join(tmpdir(), 'photo-studio-text-')); const original = process.env.PHOTO_STUDIO_DATA_DIR; process.env.PHOTO_STUDIO_DATA_DIR = directory;
  let app, base, planTaskId, saved, picture, parametersCalls = 0; let holdParameters = false; const parameterStreams = new Map();
  const parameters = { sourceAssetId: null, subject: 'keep', scene: 'warm', description: '咖啡豆暖色宣传图，不添加商品事实', ratio: '3:4', count: 1, quality: 'standard' };
  const provider = {
    run(input) {
      if (input.schema.required.includes('steps')) { ++parametersCalls; assert.match(input.prompt, /咖啡豆/); if (holdParameters) { const stream = new Readable({ objectMode: true, read() {} }); parameterStreams.set(input.taskId, stream); return stream; } return Readable.from([{ type: 'completed', result: { steps: [{ title: '咖啡宣传图', tool: 'product-image', parameters }] } }]); }
      if (input.schema.required.includes('approved')) { assert.equal(input.images.length, 1); assert.match(input.prompt, /没有原始商品图/); return Readable.from([{ type: 'completed', result: { approved: true, observation: '画面完整，符合咖啡示意需求。' } }]); }
      return Readable.from([{ type: 'completed', result: { summary: '生成一张暖色咖啡示意图', questions: [], plan: [{ title: '咖啡宣传图', tool: 'product-image', description: '暖色光线与咖啡豆' }] } }]);
    },
    generateImage(_id, source, prompt) { assert.equal(source, null); assert.match(prompt, /No source photo/); return Promise.resolve(picture); },
    cancel(id) { const stream = parameterStreams.get(id); if (stream) { stream.push({ type: 'cancelled' }); stream.push(null); parameterStreams.delete(id); } return Promise.resolve(); }
  };
  class TestModule {}
  Module({ controllers: [AgentController, AgentExecutionController, ProductImageController, ProjectsController], providers: [StorageService, ProjectsService, AgentService, ProductImageService, CommerceService, EditorService, AgentExecutionService, ImageEngineService, { provide: AGENT_MODEL_PROVIDER, useValue: provider }, { provide: PRODUCT_IMAGE_TOOL, useFactory: engine => engine.render.bind(engine), inject: [ImageEngineService] }] })(TestModule);
  const send = (path, body) => fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then(response => response.json().then(value => ({ status: response.status, body: value })));
  const wait = (path, attempt = 0) => send(path).then(result => { if (result.body.status === 'succeeded') return result.body; assert.ok(attempt < 300, JSON.stringify(result.body)); return new Promise(done => setTimeout(done, 10)).then(() => wait(path, attempt + 1)); });
  return sharp({ create: { width: 64, height: 80, channels: 4, background: '#773311' } }).png().toBuffer().then(data => { picture = data; return NestFactory.create(TestModule, { logger: false }); })
    .then(instance => { app = instance; app.setGlobalPrefix('api'); return app.listen(0, '127.0.0.1'); }).then(() => { base = `http://127.0.0.1:${app.getHttpServer().address().port}/api`; return send('/agent/sessions', { content: '制作咖啡豆宣传图' }); })
    .then(result => { planTaskId = result.body.id; return wait('/agent/tasks/' + planTaskId); })
    .then(() => send(`/agent/tasks/${planTaskId}/parameters`, { sourceAssetId: '' })).then(result => { assert.equal(result.status, 400); return send(`/agent/tasks/${planTaskId}/parameters`, { sourceAssetId: null }); })
    .then(result => { assert.equal(result.status, 201, JSON.stringify(result.body)); assert.deepEqual(result.body, { steps: [{ title: '咖啡宣传图', tool: 'product-image', parameters }] }); saved = result.body; return send(`/agent/tasks/${planTaskId}/parameters`, { sourceAssetId: null }); })
    .then(result => { assert.deepEqual(result.body, saved); assert.equal(parametersCalls, 1); return send(`/agent/tasks/${planTaskId}/parameters`); })
    .then(result => { assert.deepEqual(result.body, saved); return send('/agent/executions', { planTaskId, projectId: null, steps: [{ ...saved.steps[0], tool: 'shell' }] }); })
    .then(result => { assert.equal(result.status, 400); return send('/projects'); }).then(result => { assert.equal(result.body.length, 0); return send('/agent/executions', { planTaskId, projectId: null, steps: saved.steps }); })
    .then(result => { assert.equal(result.status, 201, JSON.stringify(result.body)); saved.execution = result.body; return wait('/agent/executions/' + result.body.id); })
    .then(execution => { assert.equal(execution.projectId, saved.execution.projectId); return send('/projects/' + execution.projectId + '/results'); })
    .then(result => { assert.equal(result.body.length, 1); assert.equal(result.body[0].width, 768); assert.equal(result.body[0].height, 1024); return send('/agent/executions', { planTaskId, projectId: null, steps: saved.steps }); })
    .then(result => { assert.equal(result.body.projectId, saved.execution.projectId); return wait('/agent/executions/' + result.body.id); })
    .then(() => send('/projects')).then(result => { assert.equal(result.body.length, 1); return send('/agent/sessions', { content: '再做一张咖啡豆主图' }); })
    .then(result => wait('/agent/tasks/' + result.body.id)).then(task => {
      holdParameters = true; const controller = new AbortController(); const service = app.get(AgentExecutionService);
      const pending = assert.rejects(service.parameters(task.id, { sourceAssetId: null }, controller.signal), /停止/);
      const ready = (attempt = 0) => { if (parameterStreams.size) return Promise.resolve(); assert.ok(attempt < 300); return new Promise(done => setTimeout(done, 10)).then(() => ready(attempt + 1)); };
      return ready().then(() => { controller.abort(); return pending; }).then(() => { assert.equal(parameterStreams.size, 0); return assert.rejects(service.draft(task.id), /尚未整理/); });
    })
    .finally(() => (app ? app.close() : Promise.resolve()).then(() => { if (original === undefined) delete process.env.PHOTO_STUDIO_DATA_DIR; else process.env.PHOTO_STUDIO_DATA_DIR = original; assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`)); assert.ok(basename(directory).startsWith('photo-studio-text-')); rmSync(directory, { recursive: true, force: true }); }));
});
