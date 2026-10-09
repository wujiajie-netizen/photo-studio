import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { CodexCliProvider, LayerSegmentationError } from '../dist/index.js';

test('local image transport isolates files, validates outputs and stops cancelled workers', context => {
  const directory = mkdtempSync(join(tmpdir(), 'photo-studio-local-tools-'));
  const original = process.env.PHOTO_STUDIO_IMAGE_TOOLS_DIR;
  process.env.PHOTO_STUDIO_IMAGE_TOOLS_DIR = directory;
  const python = join(directory, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  mkdirSync(resolve(python, '..'), { recursive: true }); writeFileSync(python, 'test executable');
  const source = Buffer.from('test pixels'); let mode = 'success'; let killed = 0;
  context.mock.method(childProcess, 'spawn', (file, args, options) => {
    assert.equal(file, python); assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
    assert.equal(options.env.OPENAI_API_KEY, undefined); assert.equal(options.env.CODEX_API_KEY, undefined);
    assert.equal(options.env.HF_HUB_OFFLINE, '1');
    const taskDirectory = args.at(-1); assert.equal(options.cwd, taskDirectory);
    assert.deepEqual(readFileSync(join(taskDirectory, 'source.png')), source);
    assert.equal(JSON.parse(readFileSync(join(taskDirectory, 'input.json'), 'utf8')).operation, mode === 'layer-failure' ? 'split-layers' : 'cutout');
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    let closed = false;
    const close = code => { if (!closed) { closed = true; queueMicrotask(() => child.emit('close', code)); } };
    child.kill = () => { killed++; close(1); return true; };
    child.stdin.on('finish', () => queueMicrotask(() => {
      if (mode === 'hold') { child.stdout.write('{"progress":10}\n'); return; }
      if (mode === 'bad-progress') { child.stdout.write('{"progress":101}\n'); return; }
      if (mode === 'failure') { child.stderr.write('No foreground found'); close(1); return; }
      if (mode === 'layer-failure') { writeFileSync(join(taskDirectory, 'failure.json'), JSON.stringify({ code: 'unreliable-layer', name: '咖啡豆', message: '物体范围包含邻物，无法可靠分离。' })); child.stderr.write('native segmentation diagnostic'); close(1); return; }
      const output = { images: [{ name: 'subject', width: 20, height: 20 }], text: [] };
      if (mode === 'bad-size') output.images[0].width = 0;
      if (mode === 'bad-text') output.text = [{ text: 'invalid', x: -1, y: 0, width: 1, height: 1 }];
      if (mode === 'gradient' || mode === 'bad-gradient') output.text = [{ text: 'Sale', x: 0, y: 0, width: 20, height: 20, rotation: 0, fill: '#ff0000', align: 'left', fontFamily: 'Arial', fontSize: 12, fontStyle: 'bold italic', letterSpacing: 0, lineHeight: 1, fillGradient: { colors: ['#ff0000', '#0000ff'], angle: mode === 'bad-gradient' ? 361 : 90 } }];
      writeFileSync(join(taskDirectory, 'output.json'), JSON.stringify(output));
      writeFileSync(join(taskDirectory, 'image-0.png'), source);
      child.stdout.write('{"progress":50}\n'); close(0);
    }));
    return child;
  });
  const provider = new CodexCliProvider(join(directory, 'runs'));
  const run = (signal = new AbortController().signal, progress = () => {}) => provider.processImage(randomUUID(), source, { operation: 'cutout' }, signal, progress);
  return run().then(output => {
    assert.deepEqual(output.images[0].data, source); assert.deepEqual(output.text, []);
    mode = 'bad-size'; return assert.rejects(run(), /图层无效/);
  }).then(() => { mode = 'bad-text'; return assert.rejects(run(), /文字图层/); })
    .then(() => { mode = 'gradient'; return run().then(output => { assert.deepEqual(output.text[0].fillGradient, { colors: ['#ff0000', '#0000ff'], angle: 90 }); assert.equal(output.text[0].fontStyle, 'bold italic'); }); })
    .then(() => { mode = 'bad-gradient'; return assert.rejects(run(), /渐变/); })
    .then(() => { mode = 'bad-progress'; return assert.rejects(run(), /进度无效/); })
    .then(() => { mode = 'failure'; return assert.rejects(run(), /No foreground found/); })
    .then(() => { mode = 'layer-failure'; return assert.rejects(provider.processImage(randomUUID(), source, { operation: 'split-layers', objects: [{ name: '咖啡豆', x: 0, y: 0, width: 20, height: 20 }] }, new AbortController().signal, () => {}), error => { assert.ok(error instanceof LayerSegmentationError); assert.equal(error.layerName, '咖啡豆'); assert.match(error.message, /物体范围/); return true; }); })
    .then(() => {
      mode = 'hold'; const controller = new AbortController();
      return assert.rejects(run(controller.signal, () => controller.abort()), /停止/);
    }).then(() => {
      assert.equal(killed, 2);
      return assert.rejects(provider.processImage('../escape', source, { operation: 'cutout' }, new AbortController().signal, () => {}), /输入无效/);
    }).finally(() => {
      if (original === undefined) delete process.env.PHOTO_STUDIO_IMAGE_TOOLS_DIR; else process.env.PHOTO_STUDIO_IMAGE_TOOLS_DIR = original;
      assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`)); rmSync(directory, { recursive: true, force: true });
    });
});
