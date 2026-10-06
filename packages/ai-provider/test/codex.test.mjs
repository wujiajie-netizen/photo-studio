import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { CodexCliProvider, inspectCodex } from '../dist/index.js';

test('CLI inspection reports installation, authentication and capability errors without model calls', (context) => {
  const originalPath = process.env.PHOTO_STUDIO_CODEX_PATH;
  process.env.PHOTO_STUDIO_CODEX_PATH = process.execPath;
  let mode = 'ready';
  const calls = [];
  context.mock.method(childProcess, 'execFile', (file, args, options, callback) => {
    assert.equal(file, process.execPath);
    assert.equal(options.windowsHide, true);
    assert.equal(options.timeout, 4000);
    calls.push(args);
    const output = args[0] === '--version' ? 'codex-cli 0.139.0' : args[0] === 'login' ? mode === 'api' ? 'Logged in using an API key' : mode === 'logout' ? 'Not logged in' : 'Logged in using ChatGPT' : mode === 'old' ? '--json' : '--json --output-schema --ignore-user-config --ignore-rules';
    const error = mode === 'missing' ? Object.assign(new Error('missing'), { code: 'ENOENT' }) : mode === 'timeout' ? Object.assign(new Error('timeout'), { code: null, killed: true }) : mode === 'logout' && args[0] === 'login' ? Object.assign(new Error('login'), { code: 1 }) : null;
    queueMicrotask(() => callback(error, output, ''));
  });
  return inspectCodex().then((result) => {
    assert.equal(result.status, 'ready');
    assert.equal(result.version, '0.139.0');
    mode = 'logout'; return inspectCodex();
  }).then((result) => { assert.equal(result.status, 'not_logged_in'); mode = 'api'; return inspectCodex(); })
    .then((result) => { assert.equal(result.status, 'unsupported'); mode = 'old'; return inspectCodex(); })
    .then((result) => { assert.equal(result.status, 'unsupported'); mode = 'missing'; return inspectCodex(); })
    .then((result) => { assert.equal(result.status, 'missing'); mode = 'timeout'; return inspectCodex(); })
    .then((result) => {
      assert.equal(result.status, 'error');
      assert.ok(calls.every((args) => args[0] === '--version' || args.join(' ') === 'login status' || args.join(' ') === 'exec --help'));
    }).finally(() => { if (originalPath === undefined) delete process.env.PHOTO_STUDIO_CODEX_PATH; else process.env.PHOTO_STUDIO_CODEX_PATH = originalPath; });
});

test('provider isolates files, decodes split UTF-8 JSONL, resumes and cancels without exposing raw events', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'photo-studio-provider-'));
  const originalPath = process.env.PHOTO_STUDIO_CODEX_PATH;
  process.env.PHOTO_STUDIO_CODEX_PATH = process.execPath;
  context.mock.method(childProcess, 'execFile', (_file, args, _options, callback) => {
    queueMicrotask(() => callback(null, args[0] === '--version' ? 'codex-cli 0.139.0' : args[0] === 'login' ? 'Logged in using ChatGPT' : '--json --output-schema --ignore-user-config --ignore-rules', ''));
  });
  let mode = 'success';
  const invocations = [];
  const providerId = randomUUID();
  const result = { summary: '咖啡商品规划', questions: [], plan: [{ title: '商品主图', description: '白底主图', tool: 'product-image' }] };
  context.mock.method(childProcess, 'spawn', (file, args, options) => {
    invocations.push({ file, args, options });
    assert.equal(options.shell, false);
    assert.equal(options.windowsHide, true);
    assert.ok(args.includes('sandbox_mode="read-only"'));
    assert.ok(args.includes('features.shell_tool=false'));
    assert.ok(args.includes('features.plugins=false'));
    assert.equal(options.env.OPENAI_API_KEY, undefined);
    assert.equal(options.env.CODEX_API_KEY, undefined);
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    let closed = false;
    const close = (code) => { if (!closed) { closed = true; queueMicrotask(() => child.emit('close', code)); } };
    child.kill = () => { close(1); return true; };
    child.stdin.on('finish', () => queueMicrotask(() => {
      let events = [{ type: 'thread.started', thread_id: providerId }, { type: 'turn.started' }];
      if (mode === 'success') events.push({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: JSON.stringify(result) } }, { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } });
      if (mode === 'tool') events.push({ type: 'item.started', item: { id: 'item_0', type: 'command_execution', command: 'forbidden' } });
      if (mode === 'quota') events.push({ type: 'turn.failed', error: { message: 'usage limit reached' } });
      const bytes = Buffer.from(events.map((event) => JSON.stringify(event)).join('\n') + '\n');
      for (let index = 0; index < bytes.length; index += 7) child.stdout.write(bytes.subarray(index, index + 7));
      if (mode !== 'hold') close(mode === 'success' ? 0 : 1);
    }));
    return child;
  });
  const provider = new CodexCliProvider(directory);
  function collect(stream, callback = () => {}) {
    const iterator = stream[Symbol.asyncIterator](); const events = [];
    const consume = () => iterator.next().then(({ value, done }) => { if (done) return events; events.push(value); callback(value); return consume(); });
    return consume();
  }
  const input = { taskId: randomUUID(), prompt: '验收需求', schema: { type: 'object' } };
  return collect(provider.run(input)).then((events) => {
    assert.deepEqual(events.at(-1), { type: 'completed', result });
    assert.ok(events.some((event) => event.type === 'content_delta' && event.text.includes('咖啡')));
    assert.ok(events.every((event) => !('thread_id' in event) && !('usage' in event)));
    assert.equal(readFileSync(join(directory, input.taskId, 'input.txt'), 'utf8'), '验收需求');
    assert.equal(invocations[0].options.cwd, join(directory, input.taskId));
    return collect(provider.continue(providerId, { ...input, taskId: randomUUID() }));
  }).then((events) => {
    assert.equal(events.at(-1).type, 'completed');
    assert.deepEqual(invocations[1].args.slice(0, 3), ['exec', 'resume', providerId]);
    mode = 'tool'; return collect(provider.run({ ...input, taskId: randomUUID() }));
  }).then((events) => { assert.match(events.at(-1).message, /未开放的工具/); mode = 'quota'; return collect(provider.run({ ...input, taskId: randomUUID() })); })
    .then((events) => {
      assert.match(events.at(-1).message, /额度/);
      mode = 'hold'; const next = { ...input, taskId: randomUUID() };
      return collect(provider.run(next), (event) => { if (event.type === 'started') provider.cancel(next.taskId); });
    }).then((events) => {
      assert.equal(events.at(-1).type, 'cancelled');
      const next = { ...input, taskId: randomUUID() }; const stream = provider.run(next); provider.cancel(next.taskId);
      return collect(stream);
    }).then((events) => { assert.equal(events.at(-1).type, 'cancelled'); return collect(provider.run({ ...input, taskId: '../escape' })); })
    .then((events) => { assert.equal(events.at(-1).type, 'failed'); assert.equal(invocations.length, 5); })
    .finally(() => {
      if (originalPath === undefined) delete process.env.PHOTO_STUDIO_CODEX_PATH; else process.env.PHOTO_STUDIO_CODEX_PATH = originalPath;
      assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`)); assert.ok(basename(directory).startsWith('photo-studio-provider-'));
      rmSync(directory, { recursive: true, force: true });
    });
});
