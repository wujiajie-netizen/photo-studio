import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import sharp from 'sharp';
import { renderMockProductImage } from '@photo-studio/tools';
import { ProductImageController } from '../dist/product-image.controller.js';
import { PRODUCT_IMAGE_TOOL, ProductImageService } from '../dist/product-image.service.js';
import { EditorController } from '../dist/editor.controller.js';
import { EditorService } from '../dist/editor.service.js';
import { StorageService } from '../dist/storage.service.js';
import { ProjectsService } from '../dist/projects.service.js';

test('editor preserves layers across restart, rejects stale revisions and invalid image references', () => {
  const directory = mkdtempSync(join(tmpdir(), 'photo-studio-editor-'));
  const original = process.env.PHOTO_STUDIO_DATA_DIR; process.env.PHOTO_STUDIO_DATA_DIR = directory;
  let app; let base; let result; let document; let content; let saved; let assetId; let wrongSizeAssetId;
  class TestModule {}
  Module({ controllers: [ProductImageController, EditorController], providers: [StorageService, ProjectsService, ProductImageService, EditorService, { provide: PRODUCT_IMAGE_TOOL, useValue: renderMockProductImage }] })(TestModule);
  function start() {
    return NestFactory.create(TestModule, { logger: false }).then(instance => { app = instance; app.setGlobalPrefix('api'); return app.listen(0, '127.0.0.1'); })
      .then(() => { base = `http://127.0.0.1:${app.getHttpServer().address().port}/api`; });
  }
  function send(path, body, method = body === undefined ? 'GET' : 'POST') {
    return fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) })
      .then(response => response.json().then(value => ({ status: response.status, body: value })));
  }
  function wait(id, attempt = 0) {
    return send(`/product-image/tasks/${id}`).then(({ body }) => {
      if (body.status === 'succeeded') return send(`/product-image/tasks/${id}/results`);
      assert.ok(attempt < 100, JSON.stringify(body)); return new Promise(done => setTimeout(done, 20)).then(() => wait(id, attempt + 1));
    });
  }
  return start().then(() => sharp({ create: { width: 80, height: 100, channels: 4, background: '#a44333' } }).png().toBuffer())
    .then(input => { const form = new FormData(); form.append('file', new Blob([input]), 'source.png'); form.append('name', '商品.png'); return fetch(`${base}/assets`, { method: 'POST', body: form }).then(response => response.json()); })
    .then(asset => {
      assetId = asset.id;
      return sharp({ create: { width: 40, height: 50, channels: 4, background: '#a44333' } }).png().toBuffer().then(input => { const form = new FormData(); form.append('file', new Blob([input]), 'small.png'); form.append('name', '尺寸不同'); return fetch(`${base}/assets`, { method: 'POST', body: form }).then(response => response.json()); });
    }).then(asset => { wrongSizeAssetId = asset.id; return send('/product-image/tasks', { sourceAssetId: assetId, subject: 'keep', scene: 'white', description: '', ratio: '1:1', count: 1, quality: 'standard' }); })
    .then(({ body }) => wait(body.id)).then(({ body }) => { result = body[0]; return send('/editor/documents', { resultId: result.id }); })
    .then(({ body }) => {
      document = body; assert.equal(document.revision, 0); assert.equal(document.background, 'transparent'); assert.equal(document.layers[0].resultId, result.id); assert.equal(document.layers[0].locked, true);
      const legacy = [{ ...document.layers[0], x: -2000, y: -100, locked: false }];
      app.get(StorageService).database.prepare('UPDATE editor_documents SET background = ?, layers = ? WHERE id = ?').run('#ffffff', JSON.stringify(legacy), document.id);
      return send('/editor/documents', { resultId: result.id });
    }).then(({ body }) => {
      document = body; assert.equal(document.revision, 1); assert.equal(document.background, 'transparent'); assert.equal(document.layers[0].x, 0); assert.equal(document.layers[0].y, 0); assert.equal(document.layers[0].locked, true);
      content = { name: '编辑后的商品', width: 1024, height: 1024, background: 'transparent', layers: [...document.layers, { id: randomUUID(), type: 'text', name: '卖点', x: 10, y: 20, width: 600, height: 100, rotation: 15, opacity: .8, visible: true, locked: false, text: '净含量 200 克', fontSize: 48, fontFamily: 'KaiTi', fill: '#202020', align: 'center' }], revision: document.revision };
      const transform = { x: 40, y: 50, width: 200, height: 160, rotation: 20, opacity: .7, visible: true, locked: false };
      Object.assign(content.layers[1], { fontStyle: 'bold italic', textDecoration: 'underline', letterSpacing: 2, lineHeight: 1.3 });
      content.layers[0].adjustments = { brightness: .1, contrast: 20, saturation: -.3, blur: 2 };
      content.layers.push({ ...transform, id: randomUUID(), type: 'shape', name: '箭头', shape: 'arrow', fill: 'transparent', stroke: '#202020', strokeWidth: 6 }, { ...transform, id: randomUUID(), type: 'path', name: '画笔', points: [0, 0, 100, 80, 200, 160], stroke: '#f00000', strokeWidth: 12 }, { ...transform, id: randomUUID(), type: 'asset-image', name: '上传素材', assetId });
      content.layers[4].matteSourceAssetId = assetId;
      return send(`/editor/documents/${document.id}`, content, 'PATCH');
    }).then(({ status, body }) => {
      assert.equal(status, 200); saved = body; assert.equal(saved.revision, content.revision + 1); assert.deepEqual(saved.layers, content.layers);
      return Promise.all([
        send(`/editor/documents/${document.id}`, content, 'PATCH').then(({ status }) => assert.equal(status, 409)),
        send(`/editor/documents/${document.id}`, { ...content, revision: saved.revision, layers: [{ ...content.layers[0], resultId: randomUUID() }] }, 'PATCH').then(({ status }) => assert.equal(status, 404)),
        send(`/editor/documents/${document.id}`, { ...content, revision: saved.revision, width: 0 }, 'PATCH').then(({ status }) => assert.equal(status, 400)),
        send(`/editor/documents/${document.id}`, { ...content, revision: saved.revision, layers: [{ ...content.layers[0], x: -2000, locked: false }, ...content.layers.slice(1)] }, 'PATCH').then(({ status, body }) => { assert.equal(status, 400); assert.match(body.message, /固定/); }),
        send(`/editor/documents/${document.id}`, { ...content, revision: saved.revision, extra: true }, 'PATCH').then(({ status }) => assert.equal(status, 400)),
        send(`/editor/documents/${document.id}`, { ...content, revision: saved.revision, layers: [{ ...content.layers[4], assetId: randomUUID() }] }, 'PATCH').then(({ status }) => assert.equal(status, 404)),
        send(`/editor/documents/${document.id}`, { ...content, revision: saved.revision, layers: [{ ...content.layers[4], matteSourceAssetId: randomUUID() }] }, 'PATCH').then(({ status }) => assert.equal(status, 404)),
        send(`/editor/documents/${document.id}`, { ...content, revision: saved.revision, layers: [{ ...content.layers[4], matteSourceAssetId: null }] }, 'PATCH').then(({ status }) => assert.equal(status, 400)),
        send(`/editor/documents/${document.id}`, { ...content, revision: saved.revision, layers: [{ ...content.layers[4], matteSourceAssetId: wrongSizeAssetId }] }, 'PATCH').then(({ status, body }) => { assert.equal(status, 400); assert.match(body.message, /尺寸/); }),
        send(`/editor/documents/${document.id}`, { ...content, revision: saved.revision, layers: [{ ...content.layers[3], points: [0, 0, 10] }] }, 'PATCH').then(({ status }) => assert.equal(status, 400)),
        send('/editor/documents', { resultId: result.id }).then(({ body }) => assert.deepEqual(body, saved))
      ]);
    }).then(() => app.close()).then(start).then(() => send(`/editor/documents/${document.id}`)).then(({ body }) => assert.deepEqual(body, saved))
    .finally(() => (app ? app.close() : Promise.resolve()).finally(() => {
      if (original === undefined) delete process.env.PHOTO_STUDIO_DATA_DIR; else process.env.PHOTO_STUDIO_DATA_DIR = original;
      assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`)); assert.ok(basename(directory).startsWith('photo-studio-editor-')); rmSync(directory, { recursive: true, force: true });
    }));
});
