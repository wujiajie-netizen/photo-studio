import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AgentController } from '../dist/agent.controller.js';
import { AGENT_MODEL_PROVIDER, AgentService } from '../dist/agent.service.js';
import { StorageService } from '../dist/storage.service.js';

test('legacy sessions migrate without losing titles, provider references or saved messages', () => {
  const directory = mkdtempSync(join(tmpdir(), 'photo-studio-session-migration-'));
  const original = process.env.PHOTO_STUDIO_DATA_DIR; process.env.PHOTO_STUDIO_DATA_DIR = directory;
  let storage;
  try {
    const database = new DatabaseSync(join(directory, 'app.db'));
    database.exec('CREATE TABLE agent_sessions (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, provider_session_id TEXT) STRICT;');
    database.prepare('INSERT INTO agent_sessions VALUES (?, ?, ?, ?, ?)').run('legacy-session', '原来的中文对话', '2026-10-08', '2026-10-09', 'provider-session');
    database.close();
    storage = new StorageService();
    const saved = storage.database.prepare('SELECT * FROM agent_sessions').get();
    assert.equal(saved.title, '原来的中文对话'); assert.equal(saved.provider_session_id, 'provider-session');
    assert.equal(saved.pinned_at, null); assert.equal(saved.deleted_at, null);
    storage.database.prepare('INSERT INTO agent_messages VALUES (?, ?, ?, ?, ?)').run('message', 'legacy-session', 'user', '原来的中文消息', '2026-10-09');
    storage.onModuleDestroy(); storage = new StorageService();
    assert.equal(storage.database.prepare('SELECT content FROM agent_messages').get().content, '原来的中文消息');
    assert.deepEqual(storage.database.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    if (storage?.database.isOpen) storage.onModuleDestroy();
    if (original === undefined) delete process.env.PHOTO_STUDIO_DATA_DIR; else process.env.PHOTO_STUDIO_DATA_DIR = original;
    assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`)); assert.ok(basename(directory).startsWith('photo-studio-session-migration-'));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('session management validates input, persists rename and pins, deletes atomically and retains projects and results', () => {
  const directory = mkdtempSync(join(tmpdir(), 'photo-studio-session-management-'));
  const original = process.env.PHOTO_STUDIO_DATA_DIR; process.env.PHOTO_STUDIO_DATA_DIR = directory;
  const first = randomUUID(); const second = randomUUID(); const third = randomUUID(); const taskId = randomUUID();
  const projectId = randomUUID(); const imageTaskId = randomUUID(); const resultId = randomUUID(); const executionId = randomUUID();
  let app; let base; let storage;
  const provider = { run() { throw new Error('Management must never invoke a model'); }, cancel() { return Promise.resolve(); } };
  class TestModule {}
  Module({ controllers: [AgentController], providers: [StorageService, AgentService, { provide: AGENT_MODEL_PROVIDER, useValue: provider }] })(TestModule);
  function start() {
    return NestFactory.create(TestModule, { logger: false }).then(instance => {
      app = instance; storage = app.get(StorageService); app.setGlobalPrefix('api'); return app.listen(0, '127.0.0.1');
    }).then(() => { base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/agent`; });
  }
  function send(path, method = 'GET', body) {
    return fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) })
      .then(response => response.json().then(value => ({ status: response.status, body: value })));
  }
  function manage(ids, action) { return send('/sessions/actions', 'POST', { ids, action }); }
  return start().then(() => {
    const database = storage.database;
    [first, second, third].forEach((id, index) => database.prepare('INSERT INTO agent_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, `中文对话${index}`, `2026-10-0${index + 6}`, `2026-10-0${index + 6}`));
    database.prepare('INSERT INTO agent_messages VALUES (?, ?, ?, ?, ?)').run(randomUUID(), first, 'user', '保留原始消息', '2026-10-06');
    database.prepare('INSERT INTO agent_tasks VALUES (?, ?, ?, ?, ?, ?)').run(taskId, first, 'succeeded', '2026-10-06', '2026-10-06', null);
    database.prepare('INSERT INTO projects VALUES (?, ?, ?, ?)').run(projectId, '保留的作品项目', '2026-10-06', '2026-10-06');
    database.prepare('INSERT INTO product_image_tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(imageTaskId, null, '{}', 'succeeded', 100, '2026-10-06', '2026-10-06', null);
    database.prepare('INSERT INTO product_image_results VALUES (?, ?, ?, ?, ?, ?, ?)').run(resultId, imageTaskId, '保留的作品.png', 1, 1, '2026-10-06', projectId);
    database.prepare('INSERT INTO agent_executions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(executionId, first, taskId, projectId, 'succeeded', 100, '[]', '2026-10-06', '2026-10-06', null);
    return send('/sessions');
  }).then(response => {
    assert.deepEqual(response.body.map(session => session.id), [third, second, first]);
    return Promise.all([
      send(`/sessions/${first}`, 'PATCH', { title: '   ' }).then(response => assert.equal(response.status, 400)),
      send(`/sessions/${first}`, 'PATCH', { title: '字'.repeat(81) }).then(response => assert.equal(response.status, 400)),
      manage([], 'pin').then(response => assert.equal(response.status, 400)),
      manage([first, first], 'delete').then(response => assert.equal(response.status, 400)),
      manage(['not-a-uuid'], 'pin').then(response => assert.equal(response.status, 400)),
      manage([first], 'share').then(response => assert.equal(response.status, 400))
    ]);
  }).then(() => send(`/sessions/${first}`, 'PATCH', { title: '  商品主图重命名😀  ' })).then(response => {
    assert.equal(response.status, 200); assert.equal(response.body.title, '商品主图重命名😀');
    return manage([second, third], 'pin');
  }).then(response => {
    assert.equal(response.status, 201); assert.deepEqual(new Set(response.body.slice(0, 2).map(session => session.id)), new Set([second, third]));
    assert.ok(response.body[0].pinnedAt); assert.equal(response.body.at(-1).id, first);
    return app.close();
  }).then(start).then(() => send('/sessions')).then(response => {
    assert.ok(response.body.find(session => session.id === second).pinnedAt);
    assert.equal(response.body.find(session => session.id === first).title, '商品主图重命名😀');
    return manage([second, third], 'unpin');
  }).then(response => {
    assert.ok(response.body.every(session => session.pinnedAt === null));
    return manage([first, randomUUID()], 'delete');
  }).then(response => {
    assert.equal(response.status, 404); assert.equal(storage.database.prepare('SELECT deleted_at FROM agent_sessions WHERE id = ?').get(first).deleted_at, null);
    storage.database.prepare("UPDATE agent_tasks SET status = 'running' WHERE id = ?").run(taskId);
    return manage([second, first], 'delete');
  }).then(response => {
    assert.equal(response.status, 409); assert.equal(storage.database.prepare('SELECT deleted_at FROM agent_sessions WHERE id = ?').get(second).deleted_at, null);
    storage.database.prepare("UPDATE agent_tasks SET status = 'succeeded' WHERE id = ?").run(taskId);
    storage.database.prepare("UPDATE agent_executions SET status = 'running' WHERE id = ?").run(executionId);
    return manage([first], 'delete');
  }).then(response => {
    assert.equal(response.status, 409);
    storage.database.prepare("UPDATE agent_executions SET status = 'succeeded' WHERE id = ?").run(executionId);
    return manage([first, second], 'delete');
  }).then(response => {
    assert.equal(response.status, 201); assert.deepEqual(response.body.map(session => session.id), [third]);
    assert.ok(storage.database.prepare('SELECT deleted_at FROM agent_sessions WHERE id = ?').get(first).deleted_at);
    assert.equal(storage.database.prepare('SELECT name FROM projects WHERE id = ?').get(projectId).name, '保留的作品项目');
    assert.equal(storage.database.prepare('SELECT project_id FROM product_image_results WHERE id = ?').get(resultId).project_id, projectId);
    assert.equal(storage.database.prepare('SELECT content FROM agent_messages WHERE session_id = ?').get(first).content, '保留原始消息');
    assert.deepEqual(storage.database.prepare('PRAGMA foreign_key_check').all(), []);
    return Promise.all([
      send(`/sessions/${first}`).then(response => assert.equal(response.status, 404)),
      send(`/sessions/${first}/messages`).then(response => assert.equal(response.status, 404)),
      send(`/sessions/${first}/tasks`).then(response => assert.equal(response.status, 404)),
      send(`/sessions/${first}/messages`, 'POST', { content: '不能恢复已删除对话' }).then(response => assert.equal(response.status, 404)),
      send(`/sessions/${first}`, 'PATCH', { title: '不能重命名' }).then(response => assert.equal(response.status, 404)),
      send(`/tasks/${taskId}`).then(response => assert.equal(response.status, 404))
    ]);
  }).then(() => app.close()).then(start).then(() => send('/sessions')).then(response => {
    assert.deepEqual(response.body.map(session => session.id), [third]);
  }).finally(() => (app ? app.close() : Promise.resolve()).finally(() => {
    if (original === undefined) delete process.env.PHOTO_STUDIO_DATA_DIR; else process.env.PHOTO_STUDIO_DATA_DIR = original;
    assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`)); assert.ok(basename(directory).startsWith('photo-studio-session-management-'));
    rmSync(directory, { recursive: true, force: true });
  }));
});
