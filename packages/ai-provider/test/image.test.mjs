import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { CodexCliProvider, ImageGenerationError } from '../dist/index.js';

test('Codex image transport accepts actual PNG events and rejects text-only success, tools, invalid images and quota errors', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'photo-studio-images-'));
  const originalPath = process.env.PHOTO_STUDIO_CODEX_PATH;
  process.env.PHOTO_STUDIO_CODEX_PATH = process.execPath;
  context.mock.method(childProcess, 'execFile', (_file, args, _options, callback) => queueMicrotask(() => callback(null, args[0] === '--version' ? 'codex-cli 0.139.0' : args[0] === 'login' ? 'Logged in using ChatGPT' : '--json --output-schema --ignore-user-config --ignore-rules', '')));
  let mode = 'success'; let hasSource = true; const invocations = [];
  const source = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2]);
  const generated = Buffer.concat([source, Buffer.from('actual image payload')]);
  context.mock.method(childProcess, 'spawn', (_file, args, options) => {
    assert.deepEqual(args.slice(0, 2), ['app-server', '--stdio']);
    assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
    assert.equal(options.env.OPENAI_API_KEY, undefined); assert.equal(options.env.CODEX_API_KEY, undefined);
    assert.ok(args.includes('features.image_generation=true')); assert.ok(args.includes('features.shell_tool=false'));
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    let closed = false; let buffer = ''; let threadId;
    child.kill = () => { if (!closed) { closed = true; queueMicrotask(() => child.emit('close', 0)); } return true; };
    const emit = (event) => { const bytes = Buffer.from(`${JSON.stringify(event)}\n`); for (let at = 0; at < bytes.length; at += 7) child.stdout.write(bytes.subarray(at, at + 7)); };
    child.stdin.on('data', (chunk) => {
      buffer += chunk.toString();
      for (let at; (at = buffer.indexOf('\n')) !== -1;) {
        const request = JSON.parse(buffer.slice(0, at)); buffer = buffer.slice(at + 1);
        invocations.push(request);
        if (request.id === undefined) continue;
        let result = {};
        if (request.method === 'modelProvider/capabilities/read') result = { imageGeneration: mode !== 'unsupported' };
        if (request.method === 'config/read') result = { config: { mcp_servers: { test_tool: { enabled: true, secret: 'must-not-be-logged' } } } };
        if (request.method === 'thread/start') {
          assert.equal(request.params.config['mcp_servers.test_tool.enabled'], false);
          assert.equal(request.params.sandbox, 'read-only'); assert.equal(request.params.ephemeral, true);
          assert.equal(request.params.cwd, options.cwd); threadId = randomUUID(); result = { thread: { id: threadId } };
        }
        if (request.method === 'turn/start') {
          assert.equal(request.params.threadId, threadId);
          if (hasSource) { assert.equal(request.params.input[1].type, 'localImage'); assert.deepEqual(readFileSync(request.params.input[1].path), source); }
          else { assert.equal(request.params.input.length, 1); assert.equal(request.params.input[0].type, 'text'); assert.ok(!readdirSync(options.cwd).includes('source.png')); }
        }
        queueMicrotask(() => {
          emit({ id: request.id, result });
          if (request.method !== 'turn/start') return;
          const item = mode === 'tool' ? { type: 'commandExecution', id: 'forbidden', command: 'forbidden' } : mode === 'text' ? { type: 'agentMessage', id: 'message', text: '图片已生成 output.png' } : { type: 'imageGeneration', id: 'image', status: 'completed', result: mode === 'invalid' ? 'not-a-png' : generated.toString('base64'), savedPath: '../forbidden-file.png' };
          if (mode === 'quota') emit({ method: 'error', params: { threadId, error: { message: 'usage limit reached 429' }, willRetry: false } });
          else if (mode !== 'hold') { emit({ method: 'item/completed', params: { threadId, item } }); emit({ method: 'turn/completed', params: { threadId, turn: { status: 'completed' } } }); }
        });
      }
    });
    return child;
  });
  const provider = new CodexCliProvider(directory);
  const generate = () => provider.generateImage(randomUUID(), source, '测试商品图', new AbortController().signal);
  return generate().then((data) => {
    assert.deepEqual(data, generated);
    const run = readdirSync(directory)[0];
    assert.equal(readFileSync(join(directory, run, 'input.txt'), 'utf8'), '测试商品图');
    assert.ok(!readFileSync(join(directory, run, 'events.jsonl'), 'utf8').includes('must-not-be-logged'));
    hasSource = false; return provider.generateImage(randomUUID(), null, '文字生成咖啡示意', new AbortController().signal);
  }).then(data => { assert.deepEqual(data, generated); hasSource = true; mode = 'text'; return assert.rejects(generate(), /未返回实际图片/); })
    .then(() => { mode = 'tool'; return assert.rejects(generate(), /生图以外/); })
    .then(() => { mode = 'invalid'; return assert.rejects(generate(), /无法读取/); })
    .then(() => { mode = 'quota'; return assert.rejects(generate(), /额度/); })
    .then(() => { mode = 'unsupported'; return assert.rejects(generate(), /不支持图片生成/); })
    .then(() => {
      mode = 'hold'; const signal = new AbortController(); const id = randomUUID();
      const waiting = provider.generateImage(id, source, '测试取消', signal.signal);
      const watch = () => { if (invocations.some((entry) => entry.method === 'turn/start' && entry.params.input[0].text === '测试取消')) signal.abort(); else setTimeout(watch, 1); }; watch();
      return assert.rejects(waiting, ImageGenerationError);
    }).then(() => {
      const id = randomUUID(); const signal = new AbortController();
      const waiting = provider.generateImage(id, source, '准备阶段取消', signal.signal);
      const duplicate = provider.generateImage(id, source, '重复任务', signal.signal);
      return provider.cancel(id).then(() => Promise.all([assert.rejects(waiting, /取消/), assert.rejects(duplicate, /已在运行/)]));
    }).finally(() => {
      if (originalPath === undefined) delete process.env.PHOTO_STUDIO_CODEX_PATH; else process.env.PHOTO_STUDIO_CODEX_PATH = originalPath;
      assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`)); assert.ok(basename(directory).startsWith('photo-studio-images-')); rmSync(directory, { recursive: true, force: true });
    });
});
