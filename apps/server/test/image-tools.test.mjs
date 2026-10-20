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
import { LayerSegmentationError } from '@photo-studio/ai-provider';
import { ImageToolController } from '../dist/image-tool.controller.js';
import { ImageToolService } from '../dist/image-tool.service.js';
import { ProductImageController } from '../dist/product-image.controller.js';
import { ProductImageService, PRODUCT_IMAGE_TOOL } from '../dist/product-image.service.js';
import { AGENT_MODEL_PROVIDER } from '../dist/agent.service.js';
import { EditorController } from '../dist/editor.controller.js';
import { EditorService } from '../dist/editor.service.js';
import { StorageService } from '../dist/storage.service.js';
import { ProjectsService } from '../dist/projects.service.js';

test('image tools preserve unmasked pixels, persist real layer outputs, validate ownership and recover interrupted tasks', () => {
  const directory = mkdtempSync(join(tmpdir(), 'photo-studio-image-tools-'));
  const original = process.env.PHOTO_STUDIO_DATA_DIR; process.env.PHOTO_STUDIO_DATA_DIR = directory;
  let app; let base; let source; let mask; let emptyMask; let resultId; let document; let eraseTask; let splitTask; let textTask; let interruptedId;
  const sessionId = randomUUID(); const foreignSessionId = randomUUID(); const projectId = randomUUID();
  const localCalls = []; let analysisCalls = 0; let generationCalls = 0; let segmentationFailures = 0; let analysisSource;
  let analysisObjects = [{ name: '主体', x: 20, y: 5, width: 40, height: 30 }, { name: '装饰', x: 3, y: 35, width: 10, height: 10 }]; const analysisImageCounts = [];
  const provider = {
    generateImage(id, input, prompt, signal, guide) {
      generationCalls++;
      if (prompt.includes('WAIT_CANCEL')) return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
      return Promise.all([sharp(input).metadata(), sharp(input).ensureAlpha().raw().toBuffer(), guide ? sharp(guide).ensureAlpha().raw().toBuffer() : null]).then(([{ width, height }, originalPixels, guidePixels]) => {
        if (guidePixels) {
          assert.match(prompt, /Image 1 is the untouched original/);
          assert.deepEqual([...originalPixels.subarray((30 * 80 + 40) * 4, (30 * 80 + 40) * 4 + 4)], [0, 0, 255, 255]);
          assert.notDeepEqual([...guidePixels.subarray((30 * 80 + 40) * 4, (30 * 80 + 40) * 4 + 4)], [0, 0, 255, 255]);
          assert.deepEqual([...guidePixels.subarray(0, 4)], [0, 0, 255, 255]);
        }
        return sharp({ create: { width, height, channels: 4, background: '#00ff00' } }).png().toBuffer();
      });
    },
    processImage(id, input, operation, signal, progress) {
      localCalls.push(operation.operation); assert.equal(signal.aborted, false);
      const previousProgress = app.get(ImageToolService).task(id).progress; progress(50);
      assert.ok(app.get(ImageToolService).task(id).progress >= previousProgress, '范围纠正后的进度不能倒退');
      if (operation.operation === 'prepare-layers') analysisSource = input;
      if (operation.operation === 'split-layers') assert.deepEqual(input, analysisSource);
      if (operation.operation === 'split-layers' && segmentationFailures > 0) { segmentationFailures--; progress(90); return Promise.reject(new LayerSegmentationError('主体', '主体范围不完整。')); }
      return sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true }).then(({ data, info }) => {
        const text = [{ text: 'COFFEE', x: 8, y: 8, width: 40, height: 12, rotation: 0, fill: '#000000', align: 'left', fontFamily: 'Arial', fontSize: 10, fontStyle: 'normal', letterSpacing: .5, lineHeight: 1 }];
        if (operation.operation !== 'split-layers') return { images: [{ data: input, width: info.width, height: info.height, name: '背景' }], text };
        return Promise.all(operation.objects.map(region => {
          const pixels = Buffer.from(data);
          for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (x < region.x || y < region.y || x >= region.x + region.width || y >= region.y + region.height) pixels[(y * info.width + x) * 4 + 3] = 0;
          return sharp(pixels, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer().then(data => ({ data, width: info.width, height: info.height, name: region.name }));
        })).then(images => ({ images: [{ data: input, width: info.width, height: info.height, name: '背景' }, ...images], text: [] }));
      });
    },
    async *run(input) {
      analysisCalls++; assert.ok(input.schema.properties.objects);
      const correcting = input.prompt.includes('This is one allowed correction');
      analysisImageCounts.push(input.images.length); assert.ok(input.images.length <= 9);
      assert.equal(input.images.length, correcting ? 2 + analysisObjects.slice(1).filter(object => Math.max(object.width, object.height) < 12).length : 2); assert.deepEqual(input.images[0], analysisSource); assert.notDeepEqual(input.images[1], analysisSource);
      if (correcting && analysisObjects.length === 2) { assert.match(input.prompt, /ORIGINAL crop left=0, top=3, width=45, height=57/); assert.equal(input.images[2].readUInt32BE(16), 135); assert.equal(input.images[2].readUInt32BE(20), 171); }
      assert.equal(input.images[1].readUInt32BE(16), 80); assert.equal(input.images[1].readUInt32BE(20), 60);
      assert.match(input.prompt, /including all blank borders/);
      yield { type: 'completed', result: { objects: analysisObjects } };
    },
    cancel() { return Promise.resolve(); }
  };
  class TestModule {}
  Module({ controllers: [ProductImageController, EditorController, ImageToolController], providers: [StorageService, ProjectsService, ProductImageService, EditorService, ImageToolService, { provide: PRODUCT_IMAGE_TOOL, useValue: renderMockProductImage }, { provide: AGENT_MODEL_PROVIDER, useValue: provider }] })(TestModule);
  function start() {
    return NestFactory.create(TestModule, { logger: false }).then(instance => { app = instance; app.setGlobalPrefix('api'); return app.listen(0, '127.0.0.1'); }).then(() => { base = `http://127.0.0.1:${app.getHttpServer().address().port}/api`; });
  }
  function send(path, body, method = body === undefined ? 'GET' : 'POST') {
    return fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) }).then(response => response.json().then(value => ({ status: response.status, body: value })));
  }
  function upload(data, name) {
    const form = new FormData(); form.append('file', new Blob([data]), name); form.append('name', name);
    return fetch(`${base}/assets`, { method: 'POST', body: form }).then(response => response.json());
  }
  function wait(id, attempt = 0) {
    return send(`/image-tools/tasks/${id}`).then(({ body }) => {
      if (!['queued', 'running'].includes(body.status)) return body;
      assert.ok(attempt < 100, JSON.stringify(body)); return new Promise(done => setTimeout(done, 20)).then(() => wait(id, attempt + 1));
    });
  }
  function submit(input) { return send('/image-tools/tasks', { sessionId, resultId, input: { sourceAssetId: source.id, ...input } }).then(({ status, body }) => { assert.equal(status, 201, JSON.stringify(body)); return wait(body.id); }).then(task => { assert.equal(task.status, 'succeeded', task.error); return task; }); }
  return start().then(() => sharp({ create: { width: 80, height: 60, channels: 4, background: '#0000ff' } }).png().toBuffer()).then(data => upload(data, 'source.png')).then(asset => {
    source = asset; const pixels = Buffer.alloc(80 * 60); for (let y = 20; y < 40; y++) pixels.fill(255, y * 80 + 30, y * 80 + 50);
    return sharp(pixels, { raw: { width: 80, height: 60, channels: 1 } }).png().toBuffer().then(data => upload(data, 'mask.png'));
  }).then(asset => { mask = asset; return sharp({ create: { width: 80, height: 60, channels: 3, background: '#000000' } }).png().toBuffer().then(data => upload(data, 'empty.png')); }).then(asset => {
    emptyMask = asset; const database = app.get(StorageService).database; const now = new Date().toISOString(); const productTaskId = randomUUID(); const planId = randomUUID(); resultId = randomUUID();
    database.prepare('INSERT INTO projects VALUES (?, ?, ?, ?)').run(projectId, '工具测试', now, now);
    for (const id of [sessionId, foreignSessionId]) database.prepare('INSERT INTO agent_sessions (id, title, created_at, updated_at, provider_session_id) VALUES (?, ?, ?, ?, ?)').run(id, '工具测试', now, now, null);
    database.prepare('INSERT INTO agent_tasks VALUES (?, ?, ?, ?, ?, ?)').run(planId, sessionId, 'succeeded', now, now, null);
    database.prepare('INSERT INTO product_image_tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(productTaskId, source.id, '{}', 'succeeded', 100, now, now, null);
    database.prepare('INSERT INTO product_image_results VALUES (?, ?, ?, ?, ?, ?, ?)').run(resultId, productTaskId, '原图.png', 80, 60, now, projectId);
    database.prepare('INSERT INTO agent_executions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), sessionId, planId, projectId, 'succeeded', 100, JSON.stringify([{ taskId: productTaskId }]), now, now, null);
    return import('node:fs/promises').then(fs => fs.copyFile(app.get(ProductImageService).assetFile(source.id), join(directory, 'generated', `${resultId}.png`)));
  }).then(() => Promise.all([
    send('/image-tools/tasks', { sessionId: foreignSessionId, resultId, input: { operation: 'cutout', sourceAssetId: source.id } }).then(({ status }) => assert.equal(status, 400)),
    send('/image-tools/tasks', { sessionId, resultId, input: { operation: 'erase', sourceAssetId: source.id, maskAssetId: mask.id, extra: true } }).then(({ status }) => assert.equal(status, 400)),
    send('/image-tools/tasks', { sessionId, resultId, input: { operation: 'expand', sourceAssetId: source.id, width: 90, height: 70, x: 20, y: 0, prompt: '' } }).then(({ status }) => assert.equal(status, 400))
  ])).then(() => submit({ operation: 'erase', maskAssetId: mask.id })).then(task => {
    eraseTask = task; assert.equal(task.outputResultIds.length, 1);
    return fetch(`${base}/product-image/results/${task.outputResultIds[0]}/file`).then(response => response.arrayBuffer()).then(bytes => sharp(Buffer.from(bytes)).ensureAlpha().raw().toBuffer());
  }).then(pixels => {
    assert.deepEqual([...pixels.subarray(0, 4)], [0, 0, 255, 255]); assert.deepEqual([...pixels.subarray((30 * 80 + 40) * 4, (30 * 80 + 40) * 4 + 4)], [0, 255, 0, 255]);
    return submit({ operation: 'split-layers' });
  }).then(task => { splitTask = task; assert.equal(task.outputLayers.length, 4); assert.equal(task.outputLayers[2].name, '装饰'); assert.equal(task.outputLayers[3].type, 'text'); assert.equal(task.outputLayers[3].text, 'COFFEE'); assert.notEqual(task.outputLayers[0].resultId, task.outputLayers[1].resultId); assert.notEqual(task.outputLayers[1].resultId, task.outputLayers[2].resultId); return send('/editor/documents', { resultId: task.outputResultIds[0] }); }).then(({ body }) => {
    document = body; assert.deepEqual(body.layers, splitTask.outputLayers); return fetch(`${base}/product-image/results/${splitTask.outputResultIds[1]}/file`).then(response => response.arrayBuffer()).then(bytes => sharp(Buffer.from(bytes)).ensureAlpha().raw().toBuffer());
  }).then(pixels => {
    assert.equal(pixels[3], 0); assert.equal(pixels[(30 * 80 + 40) * 4 + 3], 255); assert.equal(pixels[(40 * 80 + 8) * 4 + 3], 0);
    return fetch(`${base}/product-image/results/${splitTask.outputResultIds[2]}/file`).then(response => response.arrayBuffer()).then(bytes => sharp(Buffer.from(bytes)).ensureAlpha().raw().toBuffer());
  }).then(pixels => { assert.equal(pixels[(30 * 80 + 40) * 4 + 3], 0); assert.equal(pixels[(40 * 80 + 8) * 4 + 3], 255); return submit({ operation: 'recognize-text' }); }).then(task => {
    textTask = task; assert.equal(task.outputLayers[1].type, 'text'); assert.equal(task.outputLayers[1].text, 'COFFEE');
    assert.equal(task.outputLayers[1].fontFamily, 'Arial'); assert.equal(task.outputLayers[1].letterSpacing, .5);
    assert.deepEqual(localCalls, ['prepare-layers', 'split-layers', 'recognize-text']); assert.equal(analysisCalls, 1); assert.equal(generationCalls, 1);
    return send('/image-tools/tasks', { sessionId, resultId, input: { operation: 'erase', sourceAssetId: source.id, maskAssetId: emptyMask.id } }).then(({ body }) => wait(body.id));
  }).then(task => { assert.equal(task.status, 'failed'); assert.match(task.error, /涂抹/); segmentationFailures = 1; return submit({ operation: 'split-layers' }); })
    .then(task => { assert.equal(task.outputLayers.length, 4); assert.equal(analysisCalls, 3); segmentationFailures = 2; return send('/image-tools/tasks', { sessionId, resultId, input: { operation: 'split-layers', sourceAssetId: source.id } }).then(({ body }) => wait(body.id)); })
    .then(task => { assert.equal(task.status, 'failed'); assert.deepEqual(task.outputResultIds, []); assert.deepEqual(task.outputLayers, []); assert.equal(analysisCalls, 5); assert.equal(segmentationFailures, 0); segmentationFailures = 1; analysisObjects = Array.from({ length: 8 }, (_, index) => ({ name: `元素${index + 1}`, x: 2 + index % 4 * 18, y: 5 + Math.floor(index / 4) * 20, width: 10, height: 10 })); return submit({ operation: 'split-layers' }); })
    .then(task => { assert.equal(task.outputResultIds.length, 9); assert.deepEqual(analysisImageCounts.slice(-2), [2, 9]); return send('/image-tools/tasks', { sessionId, resultId, input: { operation: 'edit', sourceAssetId: source.id, maskAssetId: null, prompt: 'WAIT_CANCEL' } }); }).then(({ status, body }) => { assert.equal(status, 201, JSON.stringify(body)); return new Promise(done => setTimeout(done, 30)).then(() => send(`/image-tools/tasks/${body.id}/cancel`, {})); }).then(({ status, body }) => {
    assert.equal(status, 201, JSON.stringify(body));
    assert.equal(body.status, 'cancelled'); assert.deepEqual(body.outputResultIds, []);
    const database = app.get(StorageService).database; interruptedId = randomUUID();
    database.prepare('INSERT INTO image_tool_tasks SELECT ?, session_id, result_id, input, ?, 5, ?, ?, NULL, created_at, updated_at FROM image_tool_tasks WHERE id = ?').run(interruptedId, 'running', '[]', '[]', eraseTask.id);
    const scene = { boards: [{ resultId, x: -250, y: 480 }], selectedId: resultId, viewport: { x: 74, y: -36, zoom: .19 }, revision: 0 };
    return send(`/editor/scenes/${sessionId}`, scene, 'PATCH').then(({ status, body }) => { assert.equal(status, 200); assert.equal(body.revision, 1); assert.deepEqual(body.boards, scene.boards); return Promise.all([
      send(`/editor/scenes/${sessionId}`, scene, 'PATCH').then(({ status }) => assert.equal(status, 200)),
      send(`/editor/scenes/${sessionId}`, { ...scene, viewport: { ...scene.viewport, x: 80 } }, 'PATCH').then(({ status }) => assert.equal(status, 409)),
      send(`/editor/scenes/${foreignSessionId}`, scene, 'PATCH').then(({ status }) => assert.equal(status, 400)),
      send(`/editor/scenes/${sessionId}`, { ...scene, revision: 1, boards: [null] }, 'PATCH').then(({ status }) => assert.equal(status, 400)),
      send(`/editor/scenes/${sessionId}`, { ...scene, revision: 1, selectedId: randomUUID() }, 'PATCH').then(({ status }) => assert.equal(status, 400))
    ]); }).then(() => app.close());
  }).then(start).then(() => Promise.all([
    send(`/image-tools/tasks/${eraseTask.id}`).then(({ body }) => assert.deepEqual(body, eraseTask)),
    send(`/image-tools/tasks/${textTask.id}`).then(({ body }) => assert.deepEqual(body.outputLayers, textTask.outputLayers)),
    send(`/image-tools/tasks/${interruptedId}`).then(({ body }) => { assert.equal(body.status, 'failed'); assert.match(body.error, /重新启动/); }),
    send(`/editor/documents/${document.id}`).then(({ body }) => assert.deepEqual(body, document)),
    send(`/editor/scenes/${sessionId}`).then(({ body }) => { assert.equal(body.revision, 1); assert.deepEqual(body.viewport, { x: 74, y: -36, zoom: .19 }); assert.deepEqual(body.boards, [{ resultId, x: -250, y: 480 }]); }),
    send(`/projects/${projectId}/results`).then(({ body }) => assert.ok(body.some(result => result.id === eraseTask.outputResultIds[0])))
  ])).finally(() => (app ? app.close() : Promise.resolve()).finally(() => {
    if (original === undefined) delete process.env.PHOTO_STUDIO_DATA_DIR; else process.env.PHOTO_STUDIO_DATA_DIR = original;
    assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`)); assert.ok(basename(directory).startsWith('photo-studio-image-tools-')); rmSync(directory, { recursive: true, force: true });
  }));
});
