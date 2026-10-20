import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import sharp from 'sharp';
import { renderMockProductImage } from '@photo-studio/tools';
import { AgentExecutionService } from '../dist/agent-execution.service.js';
import { AgentService, AGENT_MODEL_PROVIDER } from '../dist/agent.service.js';
import { AgentController } from '../dist/agent.controller.js';
import { ProductImageService, PRODUCT_IMAGE_TOOL } from '../dist/product-image.service.js';
import { ProductImageController } from '../dist/product-image.controller.js';
import { CommerceService } from '../dist/commerce.service.js';
import { EditorService } from '../dist/editor.service.js';
import { EditorController } from '../dist/editor.controller.js';
import { ImageToolService } from '../dist/image-tool.service.js';
import { ProjectsService } from '../dist/projects.service.js';
import { ProjectsController } from '../dist/projects.controller.js';
import { StorageService } from '../dist/storage.service.js';

test('project creation restores source or recent sessions, retains edited documents, binds standalone works and survives restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'photo-studio-project-creation-'));
  const original = process.env.PHOTO_STUDIO_DATA_DIR; process.env.PHOTO_STUDIO_DATA_DIR = directory;
  let app; let base; let db; let emptyContext; let standaloneContext; let recovered; let sourceBytes;
  let modelCalls = 0;
  const project = randomUUID(); const empty = randomUUID(); const standalone = randomUUID(); const other = randomUUID();
  const source = randomUUID(); const recent = randomUUID(); const toolSession = randomUUID();
  const first = randomUUID(); const second = randomUUID(); const detached = randomUUID(); const foreign = randomUUID(); const toolResult = randomUUID();
  const firstTask = randomUUID(); const secondTask = randomUUID(); const detachedTask = randomUUID(); const foreignTask = randomUUID(); const toolTask = randomUUID();
  const documentId = randomUUID(); const now = new Date().toISOString();
  const provider = { run() { ++modelCalls; throw new Error('Opening creation must not invoke a model'); }, cancel() { return Promise.resolve(); } };
  class TestModule {}
  Module({ controllers: [AgentController, ProjectsController, ProductImageController, EditorController], providers: [StorageService, ProjectsService, AgentService, ProductImageService, CommerceService, EditorService, ImageToolService, AgentExecutionService, { provide: AGENT_MODEL_PROVIDER, useValue: provider }, { provide: PRODUCT_IMAGE_TOOL, useValue: renderMockProductImage }] })(TestModule);
  function start() {
    return NestFactory.create(TestModule, { logger: false }).then(instance => {
      app = instance; db = app.get(StorageService).database; app.setGlobalPrefix('api'); return app.listen(0, '127.0.0.1');
    }).then(() => { base = `http://127.0.0.1:${app.getHttpServer().address().port}/api`; });
  }
  function send(path, method = 'GET', body) {
    return fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) }).then(response => response.json().then(body => ({ status: response.status, body })));
  }
  const open = (projectId, resultId = null) => send(`/projects/${projectId}/creation`, 'POST', { resultId });
  const scene = resultId => ({ boards: [{ resultId, x: 12, y: 34 }], viewport: { x: 10, y: 20, zoom: 1 }, selectedId: resultId, revision: 0 });
  return start().then(() => {
    [project, empty, standalone, other].forEach(id => db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?)').run(id, '继续创作测试', now, now));
    [source, recent, toolSession].forEach((id, index) => db.prepare('INSERT INTO agent_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, '保留的创作对话', `2026-10-0${index + 1}`, `2026-10-0${index + 1}`));
    [[source, firstTask], [recent, secondTask]].forEach(([sessionId, taskId]) => {
      const planId = randomUUID(); db.prepare('INSERT INTO agent_tasks VALUES (?, ?, ?, ?, ?, ?)').run(planId, sessionId, 'succeeded', now, now, null);
      db.prepare('INSERT INTO agent_executions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), sessionId, planId, project, 'succeeded', 100, JSON.stringify([{ taskId }]), now, now, null);
    });
    [[firstTask, first, project], [secondTask, second, project], [detachedTask, detached, standalone], [foreignTask, foreign, other]].forEach(([taskId, resultId, projectId]) => {
      db.prepare('INSERT INTO product_image_tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(taskId, null, '{}', 'succeeded', 100, now, now, null);
      db.prepare('INSERT INTO product_image_results VALUES (?, ?, ?, ?, ?, ?, ?)').run(resultId, taskId, '已有作品.png', 64, 64, now, projectId);
    });
    db.prepare('INSERT INTO image_tool_tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(toolTask, toolSession, first, '{}', 'succeeded', 100, JSON.stringify([toolResult]), '[]', null, now, now);
    db.prepare('INSERT INTO image_tool_results VALUES (?, ?, ?, ?, ?, ?, ?)').run(toolResult, toolTask, '处理作品.png', 64, 64, now, project);
    db.prepare('INSERT INTO editor_documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(documentId, detached, standalone, '已编辑名称', 64, 64, '#123456', '[]', 7, now, now);
    return sharp({ create: { width: 64, height: 64, channels: 4, background: '#ffffff' } }).png().toBuffer();
  }).then(bytes => {
    sourceBytes = bytes;
    [first, second, detached, foreign, toolResult].forEach(id => writeFileSync(join(directory, 'generated', `${id}.png`), bytes));
    return Promise.all([
      open(project, 'invalid').then(value => assert.equal(value.status, 400)),
      open(project, foreign).then(value => assert.equal(value.status, 404)),
      open(randomUUID()).then(value => assert.equal(value.status, 404))
    ]);
  }).then(() => open(project)).then(value => {
    assert.equal(value.status, 201); assert.equal(value.body.sessionId, toolSession);
    return open(project, first);
  }).then(value => {
    assert.equal(value.body.sessionId, source); assert.equal(value.body.resultId, first);
    return open(project, second);
  }).then(value => {
    assert.equal(value.body.sessionId, recent); return open(project, toolResult);
  }).then(value => {
    assert.equal(value.body.sessionId, toolSession); return open(empty);
  }).then(value => {
    emptyContext = value.body; assert.equal(value.status, 201);
    assert.equal(db.prepare('SELECT project_id FROM agent_sessions WHERE id = ?').get(emptyContext.sessionId).project_id, empty);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM agent_tasks WHERE session_id = ?').get(emptyContext.sessionId).count, 0);
    return open(empty);
  }).then(value => {
    assert.deepEqual(value.body, emptyContext); return open(standalone, detached);
  }).then(value => {
    standaloneContext = value.body; assert.equal(value.status, 201);
    return send('/editor/documents', 'POST', { resultId: detached });
  }).then(value => {
    assert.equal(value.body.id, documentId); assert.equal(value.body.revision, 7); assert.equal(value.body.background, '#123456');
    return send(`/editor/scenes/${standaloneContext.sessionId}`, 'PATCH', scene(detached));
  }).then(value => {
    assert.equal(value.status, 200); assert.equal(value.body.selectedId, detached);
    return send(`/editor/scenes/${standaloneContext.sessionId}`, 'PATCH', { ...scene(foreign), revision: 1 });
  }).then(value => {
    assert.equal(value.status, 400);
    const images = app.get(ProductImageService); const tools = app.get(ImageToolService);
    return images.upload(sourceBytes, '图片工具验证素材').then(asset => {
      const input = { operation: 'cutout', sourceAssetId: asset.id };
      assert.throws(() => tools.submit({ sessionId: standaloneContext.sessionId, resultId: foreign, input }), /当前会话或关联项目/);
      const task = tools.submit({ sessionId: standaloneContext.sessionId, resultId: detached, input });
      assert.equal(task.resultId, detached); tools.cancel(task.id);
    });
  }).then(() => {
    /* 新项目首轮执行显式留空保存位置，也必须使用持久化的会话项目；立即取消避免调用模型。 */
    const planId = randomUUID(); const planDirectory = join(directory, 'runs', planId); mkdirSync(planDirectory);
    db.prepare('INSERT INTO agent_tasks VALUES (?, ?, ?, ?, ?, ?)').run(planId, emptyContext.sessionId, 'succeeded', now, now, null);
    writeFileSync(join(planDirectory, 'result.json'), JSON.stringify({ summary: '制作商品图', questions: [], plan: [{ title: '商品主图', description: '白底商品图', tool: 'product-image' }] }));
    const executions = app.get(AgentExecutionService);
    const execution = executions.submit({ planTaskId: planId, projectId: null, steps: [{ title: '商品主图', tool: 'product-image', parameters: { sourceAssetId: null, subject: 'keep', scene: 'white', description: '商品示意', ratio: '1:1', quality: 'standard', count: 1 } }] });
    assert.equal(execution.projectId, empty); executions.cancel(execution.id);
    db.prepare('UPDATE agent_sessions SET deleted_at = ? WHERE id = ?').run(now, source);
    return open(project, first);
  }).then(value => {
    recovered = value.body; assert.notEqual(recovered.sessionId, source);
    db.prepare('UPDATE agent_sessions SET deleted_at = ? WHERE id = ?').run(now, standaloneContext.sessionId);
    return open(standalone, detached);
  }).then(value => {
    assert.notEqual(value.body.sessionId, standaloneContext.sessionId); standaloneContext = value.body;
    return app.close();
  }).then(start).then(() => open(standalone, detached)).then(value => {
    assert.deepEqual(value.body, standaloneContext);
    return send(`/agent/sessions/${standaloneContext.sessionId}`);
  }).then(value => {
    assert.equal(value.body.projectId, standalone); assert.equal(modelCalls, 0);
    return send(`/projects/${standalone}`, 'DELETE');
  }).then(value => {
    assert.equal(value.status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM agent_sessions WHERE project_id = ?').get(standalone).count, 0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  }).finally(() => (app ? app.close() : Promise.resolve()).then(() => {
    if (original === undefined) delete process.env.PHOTO_STUDIO_DATA_DIR; else process.env.PHOTO_STUDIO_DATA_DIR = original;
    assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`)); assert.ok(basename(directory).startsWith('photo-studio-project-creation-'));
    rmSync(directory, { recursive: true, force: true });
  }));
});
