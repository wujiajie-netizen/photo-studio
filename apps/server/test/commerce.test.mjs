import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import sharp from 'sharp';
import { unzipSync } from 'fflate';
import { renderMockProductImage } from '@photo-studio/tools';
import { CommerceController } from '../dist/commerce.controller.js';
import { CommerceService } from '../dist/commerce.service.js';
import { ProductImageController } from '../dist/product-image.controller.js';
import { PRODUCT_IMAGE_TOOL, ProductImageService } from '../dist/product-image.service.js';
import { ProjectsController } from '../dist/projects.controller.js';
import { ProjectsService } from '../dist/projects.service.js';
import { AGENT_MODEL_PROVIDER } from '../dist/agent.service.js';
import { StorageService } from '../dist/storage.service.js';

test('commerce generates modules, isolates partial failure, retries one item and exports ZIP/long PNG across restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'photo-studio-commerce-'));
  const original = process.env.PHOTO_STUDIO_DATA_DIR; process.env.PHOTO_STUDIO_DATA_DIR = directory;
  let app; let base; let parameters; let task; let saved; let project; let copy;
  let calls = 0;
  const render = (input, value, index, signal) => {
    ++calls;
    if (calls === 2) return Promise.reject(new Error('one module failed'));
    return renderMockProductImage(input, value, index, signal);
  };
  const provider = { run() { return Readable.from([{ type: 'completed', result: copy }]); }, cancel() { return Promise.resolve(); } };
  class TestModule {}
  Module({ controllers: [CommerceController, ProductImageController, ProjectsController], providers: [StorageService, ProjectsService, ProductImageService, CommerceService, { provide: PRODUCT_IMAGE_TOOL, useValue: render }, { provide: AGENT_MODEL_PROVIDER, useValue: provider }] })(TestModule);
  function start() {
    return NestFactory.create(TestModule, { logger: false }).then((instance) => { app = instance; app.setGlobalPrefix('api'); return app.listen(0, '127.0.0.1'); })
      .then(() => { base = `http://127.0.0.1:${app.getHttpServer().address().port}/api`; });
  }
  function send(path, body, method = body === undefined ? 'GET' : 'POST') {
    return fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) })
      .then((response) => response.json().then((value) => ({ status: response.status, body: value })));
  }
  function wait(id, status, attempt = 0) {
    return send(`/commerce/tasks/${id}`).then(({ body }) => {
      if (body.status === status) return body;
      assert.ok(attempt < 200, JSON.stringify(body)); return new Promise((done) => setTimeout(done, 20)).then(() => wait(id, status, attempt + 1));
    });
  }
  return start().then(() => sharp({ create: { width: 100, height: 120, channels: 4, background: '#a44333' } }).png().toBuffer())
    .then((input) => {
      const form = new FormData(); form.append('file', new Blob([input]), 'source.png'); form.append('name', '商品原图.png');
      return fetch(`${base}/assets`, { method: 'POST', body: form }).then((response) => response.json());
    }).then((asset) => {
      parameters = { sourceAssetId: asset.id, subject: 'keep', scene: 'warm', ratio: '3:4', quality: 'standard', productName: '咖啡商品', platform: 'amazon', region: 'US', language: 'en-US', sellingPoints: ['烘焙香气'], sections: [{ type: 'hero', title: '商品主图', content: '咖啡包装' }, { type: 'features', title: '核心卖点', content: '烘焙香气' }, { type: 'specification', title: '规格', content: '净含量 200 克' }] };
      copy = { sellingPoints: ['Roasted aroma'], sections: [{ type: 'hero', title: 'Coffee', content: 'Coffee packaging' }, { type: 'features', title: 'Features', content: 'Roasted aroma' }, { type: 'specification', title: 'Specification', content: 'Net weight 200 g' }] };
      return Promise.all([
        send('/commerce/tasks/product-kit', { ...parameters, sections: [{ type: 'specification', title: '规格', content: '' }] }).then(({ status }) => assert.equal(status, 400)),
        send('/commerce/tasks/product-kit', { ...parameters, extra: 1 }).then(({ status }) => assert.equal(status, 400)),
        send('/commerce/tasks/unknown', parameters).then(({ status }) => assert.equal(status, 400)),
        send('/commerce/assist', parameters).then(({ status, body }) => { assert.equal(status, 201); assert.deepEqual(body, copy); })
      ]);
    }).then(() => send('/commerce/tasks/product-kit', parameters)).then(({ status, body }) => { assert.equal(status, 201); task = body; return wait(task.id, 'failed'); })
    .then((value) => {
      task = value; assert.deepEqual(task.items.map((item) => item.status), ['succeeded', 'failed', 'succeeded']); assert.equal(calls, 3);
      return fetch(`${base}/commerce/tasks/${task.id}/export?format=zip`).then((response) => assert.equal(response.status, 409));
    }).then(() => send(`/commerce/tasks/${task.id}/retry`, {})).then(() => wait(task.id, 'succeeded'))
    .then((value) => {
      task = value; assert.equal(calls, 4); assert.equal(task.progress, 100); assert.deepEqual(task.items.map((item) => item.status), ['succeeded', 'succeeded', 'succeeded']);
      return Promise.all([
        fetch(`${base}/commerce/tasks/${task.id}/export?format=zip`).then((response) => { assert.equal(response.status, 200); return response.arrayBuffer(); }).then((bytes) => assert.deepEqual(Object.keys(unzipSync(new Uint8Array(bytes))), ['1.png', '2.png', '3.png'])),
        fetch(`${base}/commerce/tasks/${task.id}/export?format=long`).then((response) => { assert.equal(response.status, 200); return response.arrayBuffer(); }).then((bytes) => sharp(Buffer.from(bytes)).metadata()).then((metadata) => { assert.equal(metadata.width, 768); assert.equal(metadata.height, 3072); }),
        send('/projects', { name: '套图验收项目' }).then(({ body }) => { project = body; })
      ]);
    }).then(() => send(`/product-image/results/${task.items[0].resultId}`, { projectId: project.id }, 'PATCH'))
    .then(({ body }) => { saved = body; assert.equal(saved.projectId, project.id); return send(`/projects/${project.id}/results`); })
    .then(({ body }) => { assert.deepEqual(body, [saved]); return send(`/commerce/tasks/${task.id}/items/${task.items[0].id}/retry`, {}); })
    .then(() => wait(task.id, 'succeeded')).then((value) => { assert.notEqual(value.items[0].resultId, saved.id); task = value; return app.close(); })
    .then(start).then(() => Promise.all([
      send(`/commerce/tasks/${task.id}`).then(({ body }) => assert.deepEqual(body, task)),
      send(`/projects/${project.id}/results`).then(({ body }) => assert.deepEqual(body, [saved])),
      send('/commerce/tasks?kind=product-kit').then(({ body }) => assert.equal(body.length, 1)),
      send('/commerce/tasks?kind=detail-page').then(({ body }) => assert.equal(body.length, 0))
    ])).finally(() => (app ? app.close() : Promise.resolve()).finally(() => {
      if (original === undefined) delete process.env.PHOTO_STUDIO_DATA_DIR; else process.env.PHOTO_STUDIO_DATA_DIR = original;
      assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`)); assert.ok(basename(directory).startsWith('photo-studio-commerce-')); rmSync(directory, { recursive: true, force: true });
    }));
});
