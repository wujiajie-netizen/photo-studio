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
import { ProjectsController } from '../dist/projects.controller.js';
import { ProjectsService } from '../dist/projects.service.js';
import { StorageService } from '../dist/storage.service.js';

test('product image HTTP flow validates upload, streams progress, saves PNGs, retries and survives restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'photo-studio-images-'));
  const original = process.env.PHOTO_STUDIO_DATA_DIR; process.env.PHOTO_STUDIO_DATA_DIR = directory;
  let app; let base; let source; let asset; let task; let results; let project; let saved;
  const controller = new AbortController();
  class TestModule {}
  Module({ controllers: [ProductImageController, ProjectsController], providers: [StorageService, ProjectsService, ProductImageService, { provide: PRODUCT_IMAGE_TOOL, useValue: renderMockProductImage }] })(TestModule);
  function start() {
    return NestFactory.create(TestModule, { logger: false }).then((instance) => {
      app = instance; app.setGlobalPrefix('api'); return app.listen(0, '127.0.0.1');
    }).then(() => { base = `http://127.0.0.1:${app.getHttpServer().address().port}/api`; });
  }
  function send(path, body, method = body === undefined ? 'GET' : 'POST') {
    return fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) })
      .then((response) => response.json().then((value) => ({ status: response.status, body: value })));
  }
  function upload(data) {
    const form = new FormData(); form.append('file', new Blob([data], { type: 'image/png' }), 'image.png'); form.append('name', '咖啡原图.png');
    return fetch(`${base}/assets`, { method: 'POST', body: form, signal: AbortSignal.timeout(5000) }).then((response) => response.json().then((value) => ({ status: response.status, body: value })));
  }
  function wait(id, attempt = 0) {
    return send(`/product-image/tasks/${id}`).then(({ body }) => {
      if (!['queued', 'running'].includes(body.status)) { assert.equal(body.status, 'succeeded'); return body; }
      assert.ok(attempt < 150); return new Promise((done) => setTimeout(done, 20)).then(() => wait(id, attempt + 1));
    });
  }
  return start().then(() => sharp({ create: { width: 100, height: 80, channels: 4, background: '#b34a22' } }).png().toBuffer())
    .then((input) => { source = input; return Promise.all([upload(Buffer.from('fake')).then(({ status }) => assert.equal(status, 400)), send('/assets', {}).then(({ status }) => assert.equal(status, 400))]); })
    .then(() => upload(source)).then(({ status, body }) => {
      assert.equal(status, 201); asset = body;
      assert.deepEqual(Object.keys(asset).sort(), ['createdAt', 'height', 'id', 'mimeType', 'name', 'size', 'width']);
      assert.equal(asset.name, '咖啡原图.png'); assert.equal(asset.width, 100);
      const parameters = { sourceAssetId: asset.id, subject: 'keep', scene: 'cool', description: '包装主图', ratio: '4:3', count: 2, quality: 'standard' };
      return Promise.all([
        send('/product-image/tasks', { ...parameters, count: 5 }).then(({ status }) => assert.equal(status, 400)),
        send('/product-image/tasks', { ...parameters, surprise: true }).then(({ status }) => assert.equal(status, 400)),
        send('/product-image/tasks', { ...parameters, sourceAssetId: randomUUID() }).then(({ status }) => assert.equal(status, 404))
      ]).then(() => send('/product-image/tasks', parameters));
    }).then(({ status, body }) => {
      assert.equal(status, 201); task = body;
      assert.deepEqual(Object.keys(task).sort(), ['createdAt', 'error', 'id', 'parameters', 'progress', 'status', 'updatedAt']);
      return fetch(`${base}/product-image/tasks/${task.id}/events`, { signal: controller.signal });
    }).then((response) => {
      assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /event-stream/);
      const reader = response.body.getReader();
      const next = () => reader.read().then(({ value }) => {
        const event = new TextDecoder().decode(value); assert.match(event, /event: task/);
        if (event.includes('"status":"succeeded"')) return reader.cancel(); return next();
      }); return next();
    }).then(() => wait(task.id)).then((value) => { task = value; assert.equal(task.progress, 100); return send(`/product-image/tasks/${task.id}/results`); })
    .then(({ body }) => {
      results = body; assert.equal(results.length, 2);
      assert.deepEqual(Object.keys(results[0]).sort(), ['createdAt', 'height', 'id', 'name', 'projectId', 'taskId', 'width']);
      assert.equal(results[0].width, 1024); assert.equal(results[0].height, 768); assert.equal(results[0].projectId, null);
      return fetch(`${base}/product-image/results/${results[0].id}/file?download=1`);
    }).then((response) => {
      assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png'); assert.match(response.headers.get('content-disposition'), /attachment/);
      return response.arrayBuffer().then((bytes) => sharp(Buffer.from(bytes)).metadata());
    }).then((metadata) => { assert.equal(metadata.format, 'png'); assert.equal(metadata.width, 1024); return send('/projects', { name: '商品图验收项目' }); })
    .then(({ body }) => { project = body; return send(`/product-image/results/${results[0].id}`, { projectId: project.id }, 'PATCH'); })
    .then(({ body }) => { saved = body; assert.equal(saved.projectId, project.id); return send(`/projects/${project.id}/results`); })
    .then(({ body }) => { assert.deepEqual(body, [saved]); return send(`/product-image/results/${results[1].id}/retry`, {}); })
    .then(({ body }) => { assert.equal(body.parameters.count, 1); return wait(body.id); })
    .then(() => app.close()).then(start).then(() => Promise.all([
      send(`/assets/${asset.id}`).then(({ body }) => assert.deepEqual(body, asset)),
      send(`/product-image/tasks/${task.id}`).then(({ body }) => assert.deepEqual(body, task)),
      send(`/projects/${project.id}/results`).then(({ body }) => assert.deepEqual(body, [saved])),
      fetch(`${base}/product-image/results/${saved.id}/file`).then((response) => assert.equal(response.status, 200))
    ])).finally(() => {
      controller.abort(); return (app ? app.close() : Promise.resolve()).finally(() => {
        if (original === undefined) delete process.env.PHOTO_STUDIO_DATA_DIR; else process.env.PHOTO_STUDIO_DATA_DIR = original;
        assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`)); assert.ok(basename(directory).startsWith('photo-studio-images-')); rmSync(directory, { recursive: true, force: true });
      });
    });
});

test('serial image queue cancels running and waiting work, retries failures and marks restart interruption', () => {
  const directory = mkdtempSync(join(tmpdir(), 'photo-studio-queue-'));
  const original = process.env.PHOTO_STUDIO_DATA_DIR; process.env.PHOTO_STUDIO_DATA_DIR = directory;
  let storage = new StorageService(); let service;
  const releases = []; const calls = [];
  const render = (_input, _parameters, _index, signal) => new Promise((resolveImage, rejectImage) => {
    calls.push(signal); releases.push({ resolve: resolveImage, reject: rejectImage });
    signal.addEventListener('abort', () => rejectImage(new Error('cancelled')), { once: true });
  });
  service = new ProductImageService(storage, new ProjectsService(storage), render);
  let parameters; let first; let second; let interrupted;
  function wait(id, status, callCount = 1, attempt = 0) {
    if (service.task(id).status === status && (status !== 'running' || releases.length >= callCount)) return Promise.resolve();
    assert.ok(attempt < 150); return new Promise((done) => setTimeout(done, 10)).then(() => wait(id, status, callCount, attempt + 1));
  }
  return sharp({ create: { width: 20, height: 20, channels: 3, background: '#ffffff' } }).png().toBuffer()
    .then((input) => service.upload(input, '排队原图.png')).then((asset) => {
      parameters = { sourceAssetId: asset.id, subject: 'keep', scene: 'white', description: '', ratio: '1:1', count: 1, quality: 'standard' };
      first = service.submit(parameters); second = service.submit(parameters); return wait(first.id, 'running');
    }).then(() => {
      assert.equal(service.task(second.id).status, 'queued'); assert.equal(calls.length, 1);
      assert.equal(service.cancel(second.id).status, 'cancelled'); assert.equal(service.cancel(first.id).status, 'cancelled');
      return wait(first.id, 'cancelled');
    }).then(() => {
      /* 等待实际工具启动，避免并行测试时固定 30ms 先于文件准备完成。 */
      first = service.retry(first.id); return wait(first.id, 'running', 2);
    }).then(() => {
      assert.equal(calls.length, 2); releases.at(-1).reject(new Error('mock failure')); return wait(first.id, 'failed');
    }).then(() => { assert.match(service.task(first.id).error, /生成失败/); assert.equal(service.results(first.id).length, 0); interrupted = service.retry(first.id); return wait(interrupted.id, 'running', 3); })
    .then(() => storage.onModuleDestroy()).then(() => {
      storage = new StorageService(); service = new ProductImageService(storage, new ProjectsService(storage), render);
      assert.equal(service.task(interrupted.id).status, 'failed'); assert.match(service.task(interrupted.id).error, /重新启动/); assert.equal(service.task(second.id).status, 'cancelled');
    }).finally(() => Promise.resolve(storage.onModuleDestroy()).finally(() => {
      if (original === undefined) delete process.env.PHOTO_STUDIO_DATA_DIR; else process.env.PHOTO_STUDIO_DATA_DIR = original;
      assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`)); assert.ok(basename(directory).startsWith('photo-studio-queue-')); rmSync(directory, { recursive: true, force: true });
    }));
});

test('image queue rejects excessive submissions and timeout cannot be overwritten by late results', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'photo-studio-timeout-'));
  const original = process.env.PHOTO_STUDIO_DATA_DIR; process.env.PHOTO_STUDIO_DATA_DIR = directory;
  const storage = new StorageService();
  let started;
  const rendering = new Promise((resolveStarted) => { started = resolveStarted; });
  const render = (_input, _parameters, _index, signal) => new Promise((_resolveImage, rejectImage) => {
    signal.addEventListener('abort', () => rejectImage(new Error('aborted')), { once: true }); started();
  });
  const service = new ProductImageService(storage, new ProjectsService(storage), render);
  let task;
  return sharp({ create: { width: 20, height: 20, channels: 3, background: '#ffffff' } }).png().toBuffer()
    .then((input) => service.upload(input, '超时原图.png')).then((asset) => {
      const parameters = { sourceAssetId: asset.id, subject: 'keep', scene: 'white', description: '', ratio: '1:1', count: 1, quality: 'standard' };
      const waiting = Array.from({ length: 10 }, () => service.submit(parameters));
      assert.throws(() => service.submit(parameters), /等待中的图片任务/);
      waiting.forEach((value) => service.cancel(value.id));
      context.mock.timers.enable({ apis: ['setTimeout'] });
      task = service.submit(parameters); return rendering;
    }).then(() => {
      context.mock.timers.tick(15 * 60 * 1000);
      assert.equal(service.task(task.id).status, 'failed'); assert.match(service.task(task.id).error, /超时/);
      return service.onApplicationShutdown();
    }).then(() => {
      assert.equal(service.task(task.id).status, 'failed'); assert.equal(service.results(task.id).length, 0);
    }).finally(() => Promise.resolve(storage.onModuleDestroy()).finally(() => {
      context.mock.timers.reset();
      if (original === undefined) delete process.env.PHOTO_STUDIO_DATA_DIR; else process.env.PHOTO_STUDIO_DATA_DIR = original;
      assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`)); assert.ok(basename(directory).startsWith('photo-studio-timeout-')); rmSync(directory, { recursive: true, force: true });
    }));
});
