import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { validateEditorContent } from '@photo-studio/shared';
import { AppModule } from '../dist/app.module.js';

test('brand and creation preset APIs validate exact data, retain snapshots and survive restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'photo-studio-presets-'));
  const originalDirectory = process.env.PHOTO_STUDIO_DATA_DIR;
  process.env.PHOTO_STUDIO_DATA_DIR = directory;
  let app; let base; let brand; let preset;
  const style = { fontFamily: 'Microsoft YaHei', primaryColor: '#6850d9', textColor: '#202020', backgroundColor: '#ffffff', styleDescription: '统一紫色、柔和影棚光、留白充足' };
  const parameters = { sourceAssetId: null, subject: 'keep', scene: 'white', ratio: '1:1', quality: 'standard', productName: '用户确认的咖啡', platform: 'taobao', region: 'CN', language: 'zh-CN', sellingPoints: ['已确认的商品卖点'], sections: [{ type: 'hero', title: '商品展示', content: '只使用用户提供的事实' }], brand: style };
  const start = () => NestFactory.create(AppModule, { logger: false }).then(instance => { app = instance; app.setGlobalPrefix('api'); return app.listen(0, '127.0.0.1'); }).then(() => { base = `http://127.0.0.1:${app.getHttpServer().address().port}/api`; });
  const send = (path, method = 'GET', body) => fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) })
    .then(response => response.json().then(body => ({ status: response.status, body })));
  /* 独立数据库验证真实接口与重启；品牌后续修改、删除不能改变已保存的方案快照。 */
  return start().then(() => send('/brand-presets', 'POST', { name: ' 咖啡品牌 ', ...style })).then(response => {
    assert.equal(response.status, 201); brand = response.body; assert.equal(brand.name, '咖啡品牌');
    return send('/creation-presets', 'POST', { name: ' 咖啡套图方案 ', kind: 'product-kit', parameters });
  }).then(response => {
    assert.equal(response.status, 201); preset = response.body; assert.deepEqual(preset.parameters.brand, style);
    return send(`/brand-presets/${brand.id}`, 'PATCH', { name: '新品牌', ...style, primaryColor: '#ff8800' });
  }).then(response => {
    assert.equal(response.status, 200); assert.equal(response.body.createdAt, brand.createdAt);
    return Promise.all([
      send('/brand-presets', 'POST', { name: '非法字段', ...style, unexpected: true }).then(response => assert.equal(response.status, 400)),
      send('/brand-presets', 'POST', { name: '非法字体', ...style, fontFamily: 'unknown' }).then(response => assert.equal(response.status, 400)),
      send('/creation-presets', 'POST', { name: '非法方案', kind: 'unknown', parameters }).then(response => assert.equal(response.status, 400)),
      send('/creation-presets?kind=unknown').then(response => assert.equal(response.status, 400)),
      send(`/creation-presets/${preset.id}`, 'PATCH', { name: '类型改变', kind: 'detail-page', parameters }).then(response => assert.equal(response.status, 400)),
      send(`/brand-presets/${randomUUID()}`, 'DELETE').then(response => assert.equal(response.status, 404)),
      send('/tasks/status').then(response => { assert.equal(response.status, 200); assert.equal(response.body.groups.length, 5); assert.ok(response.body.groups.every(group => Object.values(group.counts).every(count => count === 0))); }),
      send('/image-tools/status').then(response => { assert.equal(response.status, 200); assert.ok(['ready', 'missing', 'error'].includes(response.body.status)); assert.ok(response.body.message); })
    ]);
  }).then(() => app.close()).then(start).then(() => send('/creation-presets?kind=product-kit')).then(response => {
    assert.equal(response.status, 200); assert.deepEqual(response.body, [preset]);
    return send(`/brand-presets/${brand.id}`, 'DELETE');
  }).then(response => {
    assert.equal(response.status, 200);
    return send('/creation-presets?kind=product-kit');
  }).then(response => {
    assert.deepEqual(response.body[0].parameters.brand, style);
    return send(`/creation-presets/${preset.id}`, 'PATCH', { name: '已更新方案', kind: 'product-kit', parameters: { ...parameters, brand: null } });
  }).then(response => {
    assert.equal(response.status, 200); assert.equal(response.body.createdAt, preset.createdAt); assert.equal(response.body.parameters.brand, null);
    return send(`/creation-presets/${preset.id}`, 'DELETE');
  }).then(response => { assert.equal(response.status, 200); return send('/creation-presets'); }).then(response => assert.deepEqual(response.body, []))
    .finally(() => (app ? app.close() : Promise.resolve()).finally(() => {
      if (originalDirectory === undefined) delete process.env.PHOTO_STUDIO_DATA_DIR; else process.env.PHOTO_STUDIO_DATA_DIR = originalDirectory;
      assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`)); assert.ok(basename(directory).startsWith('photo-studio-presets-')); rmSync(directory, { recursive: true, force: true });
    }));
});

test('text gradient validation preserves old single-color layers and rejects malformed gradients', () => {
  const layer = { id: randomUUID(), type: 'text', name: '渐变标题', x: 0, y: 0, width: 100, height: 50, rotation: 0, opacity: 1, visible: true, locked: false, text: '标题', fontSize: 24, fontFamily: 'Microsoft YaHei', fill: '#202020', align: 'left' };
  const content = { name: '文字样式验收', width: 200, height: 100, background: '#ffffff', layers: [layer] };
  assert.doesNotThrow(() => validateEditorContent(content));
  assert.doesNotThrow(() => validateEditorContent({ ...content, layers: [{ ...layer, fillGradient: { colors: ['#ff0000', '#0000ff'], angle: 90 } }] }));
  for (const fillGradient of [null, { colors: ['#ff0000'], angle: 0 }, { colors: ['bad', '#ffffff'], angle: 0 }, { colors: ['#000000', '#ffffff'], angle: 361 }, { colors: ['#000000', '#ffffff'], angle: 0, unexpected: true }]) assert.throws(() => validateEditorContent({ ...content, layers: [{ ...layer, fillGradient }] }));
});
