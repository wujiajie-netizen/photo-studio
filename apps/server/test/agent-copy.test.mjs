import 'reflect-metadata';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { Subject } from 'rxjs';
import { AgentCopyService } from '../dist/agent-copy.service.js';

test('automatic executions generate persistent publication copy once and retry copy failures independently', () => {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON; CREATE TABLE agent_executions(id TEXT PRIMARY KEY) STRICT; CREATE TABLE agent_auto_flows(plan_task_id TEXT PRIMARY KEY) STRICT;');
  database.prepare('INSERT INTO agent_executions VALUES (?)').run('execution');
  database.prepare('INSERT INTO agent_auto_flows VALUES (?)').run('plan');
  const changes = new Subject();
  const execution = { id: 'execution', sessionId: 'session', planTaskId: 'plan', status: 'queued', steps: [{ parameters: { sourceAssetId: null } }] };
  const executions = { changes, task(id) { assert.equal(id, execution.id); return execution; } };
  const agent = { task() { return { createdAt: '2026-10-27T00:00:00.000Z' }; }, messages() { return [{ role: 'user', content: '旅行充电器', createdAt: '2026-10-26T00:00:00.000Z' }]; } };
  let calls = 0;
  const provider = { run(input) {
    ++calls; assert.match(input.prompt, /旅行充电器/); assert.match(input.prompt, /不要捏造品牌/);
    return Readable.from([calls === 1 ? { type: 'failed', message: '文案生成失败' } : { type: 'completed', result: { title: '轻装旅行', alternatives: ['出发更轻松'], body: '带上好心情出发。', tags: ['旅行'], engagement: '你喜欢去哪？', cta: '一起出发' } }]);
  }, cancel() { return Promise.resolve(); } };
  const service = new AgentCopyService({ database, beforeClose: [] }, agent, executions, provider);
  const wait = (status, attempt = 0) => {
    const copy = service.get(execution.id);
    if (copy.status === status) return Promise.resolve(copy);
    assert.ok(attempt < 100, JSON.stringify(copy));
    return new Promise(resolve => setTimeout(resolve, 5)).then(() => wait(status, attempt + 1));
  };
  changes.next(execution); assert.equal(service.get(execution.id).status, 'queued');
  execution.status = 'succeeded'; changes.next(execution); changes.next(execution);
  return wait('failed').then(copy => {
    assert.equal(copy.error, '文案生成失败'); assert.equal(calls, 1);
    service.retry(execution.id); return wait('succeeded');
  }).then(copy => {
    assert.equal(copy.title, '轻装旅行'); assert.deepEqual(copy.tags, ['旅行']); assert.equal(calls, 2);
    changes.next(execution); assert.equal(calls, 2);
    return service.onApplicationShutdown();
  }).finally(() => database.close());
});
