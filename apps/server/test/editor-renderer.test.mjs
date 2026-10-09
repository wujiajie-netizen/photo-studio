import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { renderEditorContent } from '../dist/editor-renderer.js';

const base = { x: 0, y: 0, width: 64, height: 64, rotation: 0, opacity: 1, visible: true, locked: false };
const shape = (kind, values = {}) => ({ ...base, id: randomUUID(), type: 'shape', name: kind, shape: kind, fill: '#ff0000', stroke: 'transparent', strokeWidth: 0, ...values });
const content = layers => ({ name: 'Renderer', width: 160, height: 160, background: 'transparent', layers });
const pixel = (image, x, y) => [...image.data.subarray((y * image.info.width + x) * 4, (y * image.info.width + x) * 4 + 4)];
const raw = bytes => sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

test('server renderer preserves every shape, brush, opacity, rotation, layer order and clipping', () => {
  const render = layers => renderEditorContent(content(layers), () => { throw new Error('no image expected'); }).then(raw);
  return render([shape('rectangle'), shape('rectangle', { fill: '#0000ff', x: 16, y: 16, visible: false })]).then(image => {
    assert.deepEqual(pixel(image, 24, 24), [255, 0, 0, 255]); assert.deepEqual(pixel(image, 90, 90), [0, 0, 0, 0]);
    return render([shape('rectangle', { x: 32, y: 32, width: 24, height: 16, rotation: 90, opacity: .5 })]);
  }).then(image => {
    assert.deepEqual(pixel(image, 24, 44).slice(0, 3), [255, 0, 0]); assert.ok(Math.abs(pixel(image, 24, 44)[3] - 128) <= 1); assert.equal(pixel(image, 44, 40)[3], 0);
    return Promise.all(['ellipse', 'triangle', 'star'].map(kind => render([shape(kind)]).then(image => { assert.equal(pixel(image, 32, 32)[3], 255); assert.equal(pixel(image, 2, 2)[3], 0); })));
  }).then(() => Promise.all(['line', 'arrow'].map(kind => render([shape(kind, { fill: 'transparent', stroke: '#00ff00', strokeWidth: 4 })]).then(image => { assert.deepEqual(pixel(image, 32, 32), [0, 255, 0, 255]); assert.equal(pixel(image, 32, 12)[3], 0); }))))
    .then(() => render([{ ...base, id: randomUUID(), type: 'path', name: 'brush', width: 100, height: 50, points: [0, 0, 10, 10, 20, 20], stroke: '#ff0000', strokeWidth: 8 }])).then(image => { assert.deepEqual(pixel(image, 50, 25), [255, 0, 0, 255]); })
    .then(() => render([shape('rectangle', { x: 150, y: 150 }), shape('rectangle', { width: 20, height: 20, fill: '#0000ff' })])).then(image => { assert.equal(image.info.width, 160); assert.deepEqual(pixel(image, 159, 159), [255, 0, 0, 255]); assert.deepEqual(pixel(image, 10, 10), [0, 0, 255, 255]); });
});

test('image and asset layers keep filters, transparency and missing references fail explicitly', () => {
  const directory = mkdtempSync(join(tmpdir(), 'photo-studio-renderer-')); const path = join(directory, 'source.png'); const resultId = randomUUID(); const assetId = randomUUID();
  const image = { ...base, id: randomUUID(), type: 'image', name: 'source', resultId, adjustments: { brightness: .1, contrast: 0, saturation: 0, blur: 0 } };
  return sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 100, g: 100, b: 100, alpha: .5 } } }).png().toBuffer().then(data => writeFile(path, data))
    .then(() => renderEditorContent(content([image, { ...base, id: randomUUID(), type: 'asset-image', name: 'asset', assetId, x: 80 }]), (kind, id) => { assert.equal(id, kind === 'image' ? resultId : assetId); return path; })).then(raw).then(result => {
      assert.ok(Math.abs(pixel(result, 32, 32)[0] - 126) <= 2); assert.ok(Math.abs(pixel(result, 32, 32)[3] - 128) <= 1); assert.ok(Math.abs(pixel(result, 112, 32)[0] - 100) <= 2);
      return assert.rejects(renderEditorContent(content([image]), () => join(directory, 'missing.png')));
    }).then(() => renderEditorContent(content([{ ...image, adjustments: { brightness: 0, contrast: 20, saturation: 0, blur: 0 } }]), () => path)).then(raw).then(result => {
      assert.ok(Math.abs(pixel(result, 32, 32)[0] - 88) <= 2);
      return sharp({ create: { width: 8, height: 8, channels: 4, background: '#c83c28' } }).png().toBuffer().then(data => writeFile(path, data));
    }).then(() => renderEditorContent(content([{ ...image, adjustments: { brightness: 0, contrast: 0, saturation: -2, blur: 0 } }]), () => path)).then(raw).then(result => {
      const color = pixel(result, 32, 32); assert.ok(color[0] - color[2] >= 38 && color[0] - color[2] <= 42);
      return sharp({ create: { width: 64, height: 64, channels: 4, background: '#000000' } }).composite([{ input: { create: { width: 32, height: 64, channels: 4, background: '#ffffff' } }, left: 32, top: 0 }]).png().toBuffer().then(data => writeFile(path, data));
    }).then(() => renderEditorContent(content([{ ...image, adjustments: { brightness: 0, contrast: 0, saturation: 0, blur: 4 } }]), () => path)).then(raw).then(result => {
      assert.equal(pixel(result, 10, 32)[0], 0); assert.equal(pixel(result, 54, 32)[0], 255); assert.ok(pixel(result, 31, 32)[0] > 0 && pixel(result, 31, 32)[0] < 255);
    }).finally(() => { assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`)); assert.ok(basename(directory).startsWith('photo-studio-renderer-')); rmSync(directory, { recursive: true, force: true }); });
});

test('text layers render real glyphs and local horizontal gradient colors', () => {
  const text = { ...base, id: randomUUID(), type: 'text', name: 'editable', width: 150, height: 90, text: 'MMMM', fontSize: 48, fontFamily: 'Arial', fill: '#000000', align: 'left', fontStyle: 'bold', textDecoration: 'underline', letterSpacing: 2, lineHeight: 1.3, fillGradient: { colors: ['#ff0000', '#0000ff'], angle: 0 } };
  return renderEditorContent(content([text]), () => { throw new Error('no image expected'); }).then(raw).then(image => {
    const glyphs = Array.from({ length: image.info.width * 80 }, (_, offset) => ({ x: offset % image.info.width, pixel: [...image.data.subarray(offset * 4, offset * 4 + 4)] })).filter(item => item.pixel[3] > 240);
    assert.ok(glyphs.length > 500); assert.ok(glyphs.some(item => item.x < 30 && item.pixel[0] > item.pixel[2])); assert.ok(glyphs.some(item => item.x > 110 && item.pixel[2] > item.pixel[0]));
  });
});
