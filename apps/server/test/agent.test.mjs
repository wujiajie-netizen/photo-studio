import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AgentController } from '../dist/agent.controller.js';
import { AGENT_MODEL_PROVIDER, AgentService } from '../dist/agent.service.js';
import { StorageService } from '../dist/storage.service.js';

test('Agent API persists sessions, streams saved states, validates plans and controls queued/running cancellation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'photo-studio-agent-'));
  const originalDirectory = process.env.PHOTO_STUDIO_DATA_DIR;
  process.env.PHOTO_STUDIO_DATA_DIR = directory;
  const streams = new Map(); const calls = [];
  const providerId = randomUUID();
  const provider = {
    run(input) {
      calls.push({ input, continued: false });
      const stream = new Readable({ objectMode: true, read() {} }); streams.set(input.taskId, stream);
      queueMicrotask(() => stream.push({ type: 'started', sessionId: providerId }));
      return stream;
    },
    continue(sessionId, input) { const stream = this.run(input); calls.at(-1).continued = sessionId; return stream; },
    cancel(id) { const stream = streams.get(id); if (stream) { stream.push({ type: 'cancelled' }); stream.push(null); } return Promise.resolve(); }
  };
  class TestModule {}
  Module({ controllers: [AgentController], providers: [StorageService, AgentService, { provide: AGENT_MODEL_PROVIDER, useValue: provider }] })(TestModule);
  let app; let base; let first; let second; let failed; let queued;
  const streamAbort = new AbortController();
  const plan = { summary: '咖啡商品主图计划', questions: [], plan: [{ title: '主图构图', description: '方形白底，突出包装', tool: 'product-image' }] };
  function start() {
    return NestFactory.create(TestModule, { logger: false }).then((instance) => {
      app = instance; app.setGlobalPrefix('api'); return app.listen(0, '127.0.0.1');
    }).then(() => { base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/agent`; });
  }
  function send(path, body) {
    return fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) })
      .then((response) => response.json().then((result) => ({ status: response.status, body: result })));
  }
  function wait(id, status, attempt = 0) {
    return send(`/tasks/${id}`).then((response) => {
      if (response.body.status === status) return response.body;
      assert.ok(attempt < 100, `waiting for ${status}: ${JSON.stringify(response.body)}`);
      return new Promise((resolveWait) => setTimeout(resolveWait, 20)).then(() => wait(id, status, attempt + 1));
    });
  }
  function complete(id, result = plan) { streams.get(id).push({ type: 'completed', result }); streams.get(id).push(null); }
  /* 模拟模型边界，其余使用真实图、HTTP、SSE 和 SQLite；测试不消耗额度也不触及正式数据。 */
  return start().then(() => Promise.all([
    send('/sessions', { content: '  ' }).then((response) => assert.equal(response.status, 400)),
    send('/sessions', { content: '字'.repeat(2001) }).then((response) => assert.equal(response.status, 400)),
    send('/sessions/not-uuid').then((response) => assert.equal(response.status, 400)),
    send(`/sessions/${randomUUID()}`).then((response) => assert.equal(response.status, 404))
  ])).then(() => send('/sessions', { content: ' 咖啡主图需求 ' })).then((response) => {
    assert.equal(response.status, 201); first = response.body;
    assert.deepEqual(Object.keys(first).sort(), ['createdAt', 'error', 'id', 'sessionId', 'status', 'updatedAt']);
    return wait(first.id, 'running');
  }).then(() => Promise.all([
    send(`/sessions/${first.sessionId}/messages`, { content: '重复提交' }).then((response) => assert.equal(response.status, 409)),
    send(`/tasks/${first.id}/result`).then((response) => assert.equal(response.status, 409)),
    send('/sessions', { content: '套图等待需求' }).then((response) => { queued = response.body; assert.equal(response.body.status, 'queued'); })
  ])).then(() => send(`/tasks/${queued.id}/cancel`, {})).then((response) => {
    assert.equal(response.body.status, 'cancelled'); assert.equal(calls.length, 1);
    return fetch(`${base}/sessions/${first.sessionId}/events`, { signal: streamAbort.signal });
  }).then((response) => {
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const reader = response.body.getReader();
    return reader.read().then(({ value }) => {
      assert.match(new TextDecoder().decode(value), /event: task/);
      assert.match(new TextDecoder().decode(value), /"status":"running"/);
      complete(first.id);
      const next = () => reader.read().then(({ value }) => { if (new TextDecoder().decode(value).includes('"status":"succeeded"')) return; return next(); });
      return next().then(() => reader.cancel());
    });
  }).then(() => wait(first.id, 'succeeded')).then(() => Promise.all([
    send(`/tasks/${first.id}/result`).then((response) => assert.deepEqual(response.body, plan)),
    send(`/sessions/${first.sessionId}`).then((response) => { assert.deepEqual(Object.keys(response.body).sort(), ['createdAt', 'id', 'title', 'updatedAt']); assert.equal(response.body.title, '咖啡主图需求'); }),
    send(`/sessions/${first.sessionId}/messages`).then((response) => { assert.deepEqual(response.body.map((message) => message.role), ['user', 'assistant']); })
  ])).then(() => send(`/sessions/${first.sessionId}/messages`, { content: '补充咖啡卖点' })).then((response) => { second = response.body; return wait(second.id, 'running'); })
    .then(() => {
      assert.equal(calls.at(-1).continued, providerId);
      assert.ok(calls.at(-1).input.prompt.includes('补充咖啡卖点'));
      assert.ok(calls.at(-1).input.prompt.includes('咖啡主图需求'));
      assert.ok(calls.at(-1).input.prompt.includes('咖啡商品主图计划'));
      complete(second.id, { summary: '请补充平台', questions: ['上架哪个平台？'], plan: [] }); return wait(second.id, 'succeeded');
    }).then(() => send(`/sessions/${first.sessionId}/messages`, { content: '第三次需求' })).then((response) => { failed = response.body; return wait(failed.id, 'running'); })
    .then(() => { complete(failed.id, { ...plan, plan: [{ ...plan.plan[0], tool: 'shell' }] }); return wait(failed.id, 'failed'); })
    .then((task) => { assert.match(task.error, /未通过校验/); return send(`/sessions/${first.sessionId}/messages`, { content: '取消这次任务' }); })
    .then((response) => { failed = response.body; return wait(failed.id, 'running'); })
    .then(() => send(`/tasks/${failed.id}/cancel`, {})).then((response) => { assert.equal(response.body.status, 'cancelled'); return wait(failed.id, 'cancelled'); })
    .then(() => app.close()).then(() => start()).then(() => Promise.all([
      send(`/tasks/${first.id}/result`).then((response) => assert.deepEqual(response.body, plan)),
      send(`/sessions/${first.sessionId}/messages`).then((response) => assert.equal(response.body.length, 6)),
      send(`/sessions/${first.sessionId}/tasks`).then((response) => assert.deepEqual(response.body.map((task) => task.status), ['succeeded', 'succeeded', 'failed', 'cancelled']))
    ])).then(() => send(`/sessions/${first.sessionId}/messages`, { content: '重启后继续需求' })).then((response) => { second = response.body; return wait(second.id, 'running'); })
    .then(() => { assert.equal(calls.at(-1).continued, providerId); complete(second.id); return wait(second.id, 'succeeded'); })
    .then(() => send('/sessions', { content: '重启中断需求' })).then((response) => { failed = response.body; return wait(failed.id, 'running'); })
    .then(() => app.close()).then(() => start()).then(() => send(`/tasks/${failed.id}`))
    .then((response) => { assert.equal(response.body.status, 'failed'); assert.match(response.body.error, /重新启动/); })
    .finally(() => {
      streamAbort.abort();
      return (app ? app.close() : Promise.resolve()).finally(() => {
        if (originalDirectory === undefined) delete process.env.PHOTO_STUDIO_DATA_DIR; else process.env.PHOTO_STUDIO_DATA_DIR = originalDirectory;
        assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`)); assert.ok(basename(directory).startsWith('photo-studio-agent-'));
        rmSync(directory, { recursive: true, force: true });
      });
    });
});
