import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import sharp from 'sharp';
import { prepareProductImage, renderMockProductImage } from '../dist/index.js';

test('upload checks decoded formats, dimensions and EXIF orientation', () => {
  return sharp({ create: { width: 60, height: 40, channels: 3, background: '#aa4433' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer()
    .then(prepareProductImage).then((image) => {
      assert.equal(image.width, 40); assert.equal(image.height, 60);
      return sharp(image.data).metadata();
    }).then((metadata) => {
      assert.equal(metadata.format, 'png'); assert.equal(metadata.orientation, undefined);
      return Promise.all([
        assert.rejects(prepareProductImage(Buffer.from('fake image'))),
        assert.rejects(prepareProductImage(Buffer.from('<svg width="10" height="10"></svg>'))),
        assert.rejects(prepareProductImage(Buffer.alloc(20 * 1024 * 1024 + 1)))
      ]);
    }).then(() => sharp({ create: { width: 4001, height: 4000, channels: 3, background: '#ffffff' } }).png().toBuffer())
    .then((input) => assert.rejects(prepareProductImage(input)));
});

test('mock tool outputs actual PNG backgrounds and ratio sizes, trims margins and obeys cancellation', () => {
  const parameters = { sourceAssetId: randomUUID(), subject: 'trim', scene: 'warm', description: '咖啡包装', ratio: '3:4', count: 4, quality: 'standard' };
  let source;
  return sharp({ create: { width: 100, height: 80, channels: 4, background: '#ffffff' } })
    .composite([{ input: { create: { width: 40, height: 40, channels: 4, background: '#ff0000' } }, left: 30, top: 20 }]).png().toBuffer()
    .then((input) => { source = input; return renderMockProductImage(input, parameters, 0, new AbortController().signal); })
    .then((image) => {
      assert.equal(image.width, 768); assert.equal(image.height, 1024);
      return sharp(image.data).raw().toBuffer({ resolveWithObject: true });
    }).then(({ data, info }) => {
      assert.deepEqual([...data.subarray(0, 4)], [245, 235, 221, 255]);
      const center = (512 * info.width + 384) * info.channels;
      assert.deepEqual([...data.subarray(center, center + 4)], [255, 0, 0, 255]);
      // 裁去白边后红色主体占满配置的主体区域，原图白边没有进入结果。
      const subjectEdge = (512 * info.width + 150) * info.channels;
      assert.deepEqual([...data.subarray(subjectEdge, subjectEdge + 4)], [255, 0, 0, 255]);
      return renderMockProductImage(source, { ...parameters, scene: 'cool', ratio: '9:16', quality: 'high' }, 3, new AbortController().signal);
    }).then((image) => {
      assert.equal(image.width, 1152); assert.equal(image.height, 2048);
      return sharp(image.data).metadata();
    }).then((metadata) => {
      assert.equal(metadata.format, 'png');
      const controller = new AbortController(); controller.abort();
      return assert.rejects(renderMockProductImage(source, parameters, 0, controller.signal), /取消/);
    });
});
