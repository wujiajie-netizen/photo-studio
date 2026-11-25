import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import sharp from 'sharp';
import { renderMockProductImage } from '@photo-studio/tools';
import { AgentAutoFlowService } from '../dist/agent-auto-flow.service.js';
import { AgentAutoFlowController } from '../dist/agent-auto-flow.controller.js';
import { AgentService, AGENT_MODEL_PROVIDER } from '../dist/agent.service.js';
import { AgentController } from '../dist/agent.controller.js';
import { AgentExecutionService } from '../dist/agent-execution.service.js';
import { AgentExecutionController } from '../dist/agent-execution.controller.js';
import { ProductImageService, PRODUCT_IMAGE_TOOL } from '../dist/product-image.service.js';
import { ProductImageController } from '../dist/product-image.controller.js';
import { CommerceService } from '../dist/commerce.service.js';
import { EditorService } from '../dist/editor.service.js';
import { ProjectsService } from '../dist/projects.service.js';
import { ProjectsController } from '../dist/projects.controller.js';
import { StorageService } from '../dist/storage.service.js';

test('自动流程持久化绑定素材，追问不生成，成功与刷新不重复执行', () => {
  const directory = mkdtempSync(join(tmpdir(), 'photo-studio-auto-')); const original = process.env.PHOTO_STUDIO_DATA_DIR; process.env.PHOTO_STUDIO_DATA_DIR = directory;
  let app, base, source, first, second, executions, project, renders = 0, questions = true, mode = 'normal';
  const states = []; const executionEvents = []; const pending = new Map();
  const provider = { run(input) {
    if (input.schema.required.includes('steps')) {
      assert.equal(input.images.length, 1);
      if (mode === 'failure') return Readable.from([{ type: 'failed', message: '参数整理失败' }]);
      if (mode === 'hold') { const stream = new Readable({ objectMode: true, read() {} }); pending.set(input.taskId, stream); return stream; }
      return Readable.from([{ type: 'completed', result: { steps: [{ title: '商品图', tool: 'product-image', parameters: { sourceAssetId: source, subject: 'keep', scene: 'warm', description: '旅行场景', ratio: '3:4', count: 1, quality: 'standard' } }] } }]);
    }
    if (input.schema.required.includes('approved')) return Readable.from([{ type: 'completed', result: { approved: true, observation: '画面完整。' } }]);
    if (!input.prompt.includes('旧手动任务')) assert.match(input.prompt, /本轮已绑定商品素材/);
    if (input.prompt.includes('一张 3:4')) assert.match(input.prompt, /需要几张？/);
    return Readable.from([{ type: 'completed', result: questions ? { summary: '请补充。', questions: ['需要几张？'], plan: [] } : { summary: '开始制作。', questions: [], plan: [{ title: '商品图', description: '旅行场景', tool: 'product-image' }] } }]);
  }, cancel(id) { const stream = pending.get(id); if (stream) { stream.push({ type: 'cancelled' }); stream.push(null); pending.delete(id); } return Promise.resolve(); } };
  class TestModule {}
  Module({ controllers: [AgentController, AgentAutoFlowController, AgentExecutionController, ProductImageController, ProjectsController], providers: [StorageService, ProjectsService, AgentService, ProductImageService, CommerceService, EditorService, AgentExecutionService, AgentAutoFlowService, { provide: AGENT_MODEL_PROVIDER, useValue: provider }, { provide: PRODUCT_IMAGE_TOOL, useValue: (...args) => { ++renders; return renderMockProductImage(...args); } }] })(TestModule);
  const start = () => NestFactory.create(TestModule, { logger: false }).then(instance => { app = instance; app.get(AgentAutoFlowService).changes.subscribe(flow => states.push(flow.status)); app.get(AgentExecutionService).changes.subscribe(execution => executionEvents.push(execution)); app.setGlobalPrefix('api'); return app.listen(0, '127.0.0.1'); }).then(() => { base = `http://127.0.0.1:${app.getHttpServer().address().port}/api`; });
  const send = (path, body) => fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then(response => response.json().then(value => ({ status: response.status, body: value })));
  const wait = (session, taskId, expected, attempt = 0) => send(`/agent/sessions/${session}/flows`).then(result => { const flow = result.body.find(item => item.taskId === taskId); if (flow?.status === expected) return flow; assert.ok(attempt < 400, JSON.stringify(flow)); return new Promise(done => setTimeout(done, 10)).then(() => wait(session, taskId, expected, attempt + 1)); });
  return start().then(() => sharp({ create: { width: 30, height: 40, channels: 4, background: '#773311' } }).png().toBuffer()).then(data => {
    const form = new FormData(); form.append('file', new Blob([data]), 'source.png'); form.append('name', '原图'); return fetch(base + '/assets', { method: 'POST', body: form }).then(response => response.json());
  }).then(asset => { source = asset.id; return send('/agent/sessions', { content: '做商品图', sourceAssetId: source, projectId: null }); })
    .then(result => { first = result.body; return wait(first.sessionId, first.id, 'clarifying'); })
    .then(flow => { assert.equal(flow.sourceAssetId, source); assert.equal(renders, 0); questions = false; return send(`/agent/sessions/${first.sessionId}/messages`, { content: '一张 3:4', sourceAssetId: source, projectId: null }); })
    .then(result => { second = result.body; return wait(first.sessionId, second.id, 'succeeded'); })
    .then(flow => { assert.equal(flow.sourceAssetId, source); assert.ok(flow.executionId); assert.equal(renders, 1); assert.ok(states.includes('preparing')); assert.ok(states.includes('executing')); assert.ok(executionEvents.some(event => event.id === flow.executionId && event.status === 'succeeded')); return send(`/agent/tasks/${second.id}/executions`); })
    .then(result => { executions = result.body; assert.equal(executions.length, 1); const body = { planTaskId: second.id, projectId: null, steps: executions[0].steps.map(step => ({ title: step.title, tool: step.tool, parameters: step.parameters })) }; return Promise.all([send('/agent/executions', body), send('/agent/executions', body)]); })
    .then(results => { assert.ok(results.every(result => result.status === 409)); app.get(StorageService).database.prepare("INSERT INTO agent_publication_copy VALUES (?, 'running', '{}', NULL)").run(executions[0].id); return send('/agent/sessions/actions', { ids: [first.sessionId], action: 'delete' }); })
    .then(result => { assert.equal(result.status, 409); return fetch(base + `/projects/${executions[0].projectId}`, { method: 'DELETE' }); })
    .then(result => { assert.equal(result.status, 409); app.get(StorageService).database.prepare("UPDATE agent_publication_copy SET status = 'succeeded' WHERE execution_id = ?").run(executions[0].id); return app.close(); }).then(start)
    .then(() => wait(first.sessionId, second.id, 'succeeded')).then(flow => { assert.equal(flow.executionId, executions[0].id); assert.equal(renders, 1); return send(`/agent/sessions/${first.sessionId}/flows`); })
    .then(result => { assert.deepEqual(result.body.map(item => item.taskId), [first.id, second.id]); assert.equal(result.body[0].sourceAssetId, source); return send('/agent/sessions', { content: '旧手动任务' }); })
    .then(result => { const task = result.body; const check = (attempt = 0) => send(`/agent/tasks/${task.id}`).then(value => { if (value.body.status === 'succeeded') return; assert.ok(attempt < 400); return new Promise(done => setTimeout(done, 10)).then(() => check(attempt + 1)); }); return check().then(() => send(`/agent/tasks/${task.id}/executions`)).then(value => { assert.deepEqual(value.body, []); assert.equal(renders, 1); }); })
    .then(() => { mode = 'failure'; return send('/agent/sessions', { content: '准备失败', sourceAssetId: source, projectId: null }); })
    .then(result => wait(result.body.sessionId, result.body.id, 'failed')).then(flow => {
      assert.match(flow.error, /参数整理失败/); assert.equal(flow.executionId, null); assert.equal(renders, 1);
      const service = app.get(AgentExecutionService); const parameters = service.parameters; service.parameters = () => { throw new Error('准备队列已满'); };
      return send('/agent/sessions', { content: '准备队列满', sourceAssetId: source, projectId: null }).then(result => wait(result.body.sessionId, result.body.id, 'failed')).then(failed => { assert.match(failed.error, /准备队列已满/); service.parameters = parameters; });
    }).then(() => { mode = 'hold'; return send('/projects', { name: '准备期间的项目' }); }).then(result => { project = result.body.id; return send('/agent/sessions', { content: '准备取消', sourceAssetId: source, projectId: project }); })
    .then(result => { const task = result.body; return wait(task.sessionId, task.id, 'preparing').then(() => fetch(base + `/assets/${source}`, { method: 'DELETE' })).then(response => { assert.equal(response.status, 409); return fetch(base + `/projects/${project}`, { method: 'DELETE' }); }).then(response => { assert.equal(response.status, 409); return send('/agent/sessions/actions', { ids: [task.sessionId], action: 'delete' }); }).then(response => { assert.equal(response.status, 409); return send(`/agent/tasks/${task.id}/flow/cancel`, {}); }).then(response => { assert.equal(response.body.status, 'cancelled'); return wait(task.sessionId, task.id, 'cancelled'); }).then(flow => { assert.equal(flow.executionId, null); assert.equal(renders, 1); }); })
    .finally(() => (app ? app.close() : Promise.resolve()).then(() => { if (original === undefined) delete process.env.PHOTO_STUDIO_DATA_DIR; else process.env.PHOTO_STUDIO_DATA_DIR = original; assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`)); rmSync(directory, { recursive: true, force: true }); }));
});
