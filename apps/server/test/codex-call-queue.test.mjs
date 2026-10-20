import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CodexCallQueue, QueuedModelProvider } from '../dist/codex-call-queue.js';

test('different account providers share one execution slot and cancelled waiting jobs never start', () => {
  const queue = new CodexCallQueue(); let release;
  const gate = new Promise(done => { release = done; });
  const calls = []; let active = 0; let peak = 0;
  const provider = {
    generateImage(id) {
      calls.push(id); ++active; peak = Math.max(peak, active);
      return Promise.resolve().then(() => { --active; return Buffer.from(id); });
    },
    run(input) {
      calls.push(input.taskId);
      const events = [{ type: 'completed', result: input.taskId }];
      return { [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve(events.length ? { done: false, value: events.shift() } : { done: true }) }) };
    },
    cancel() { return Promise.resolve(); }
  };
  const first = new QueuedModelProvider(provider, queue); const second = new QueuedModelProvider(provider, queue);
  const blocked = queue.enqueue(() => gate);
  const cancelled = second.run({ taskId: 'cancelled', prompt: '', schema: {} });
  const results = [];
  const iterator = cancelled[Symbol.asyncIterator]();
  const collect = () => iterator.next().then(item => { if (!item.done) { results.push(item.value); return collect(); } });
  const signal = new AbortController();
  const a = first.generateImage('first-account', null, '', signal.signal);
  const b = second.generateImage('second-account', null, '', signal.signal);
  return second.cancel('cancelled').then(() => { release(); return Promise.all([blocked, collect(), a, b]); })
    .then(() => {
      assert.deepEqual(calls, ['first-account', 'second-account']); assert.equal(peak, 1);
      assert.deepEqual(results, [{ type: 'cancelled' }]);
      return queue.enqueue(() => Promise.reject(new Error('test failure'))).catch(() => {});
    }).then(() => first.generateImage('after-failure', null, '', signal.signal))
    .then(() => { assert.equal(calls.at(-1), 'after-failure'); });
});
