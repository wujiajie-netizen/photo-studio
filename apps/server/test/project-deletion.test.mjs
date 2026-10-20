import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';
import { StorageService } from '../dist/storage.service.js';

test('physical deletion distinguishes a single image from its whole project and conversation, validates references and rolls back failures', () => {
  const directory = mkdtempSync(join(tmpdir(), 'photo-studio-project-deletion-'));
  const original = process.env.PHOTO_STUDIO_DATA_DIR; process.env.PHOTO_STUDIO_DATA_DIR = directory;
  let app; let base; let db;
  const project = randomUUID(); const other = randomUUID(); const session = randomUUID(); const otherSession = randomUUID();
  const plan = randomUUID(); const execution = randomUUID(); const product = randomUUID(); const commerce = randomUUID(); const tool = randomUUID();
  const first = randomUUID(); const second = randomUUID(); const third = randomUUID(); const fourth = randomUUID(); const sibling = randomUUID();
  const asset = randomUUID(); const otherAsset = randomUUID(); const document = randomUUID(); const otherDocument = randomUUID(); const now = new Date().toISOString();
  const image = id => ({ id: randomUUID(), type: 'image', name: '图片', resultId: id, x: 0, y: 0, width: 10, height: 10, rotation: 0, opacity: 1, visible: true, locked: false });
  const assetImage = id => ({ ...image(first), type: 'asset-image', resultId: undefined, assetId: id });
  function start() {
    return NestFactory.create(AppModule, { logger: false }).then(instance => {
      app = instance; db = app.get(StorageService).database; app.setGlobalPrefix('api'); return app.listen(0, '127.0.0.1');
    }).then(() => { base = `http://127.0.0.1:${app.getHttpServer().address().port}/api`; });
  }
  function send(path, method = 'GET', body) {
    return fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) }).then(response => response.json().then(body => ({ status: response.status, body })));
  }
  function count(table, id) { return db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE id = ?`).get(id).count; }
  return start().then(() => {
    [project, other].forEach(id => db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?)').run(id, '商品项目', now, now));
    [session, otherSession].forEach(id => db.prepare('INSERT INTO agent_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, '完整中文对话', now, now));
    db.prepare('INSERT INTO agent_messages VALUES (?, ?, ?, ?, ?)').run(randomUUID(), session, 'user', '单图删除后保留的文字', now);
    db.prepare('INSERT INTO agent_tasks VALUES (?, ?, ?, ?, ?, ?)').run(plan, session, 'succeeded', now, now, null);
    [asset, otherAsset].forEach(id => db.prepare('INSERT INTO product_assets VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, '商品素材.png', 'image/png', 20, 10, 10, now));
    db.prepare('INSERT INTO product_image_tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(product, asset, JSON.stringify({ sourceAssetId: asset }), 'succeeded', 100, now, now, null);
    [first, second, sibling].forEach(id => db.prepare('INSERT INTO product_image_results VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, product, '商品图.png', 10, 10, now, id === sibling ? null : project));
    db.prepare('INSERT INTO commerce_tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(commerce, 'product-kit', '{}', 'succeeded', 100, JSON.stringify([{ id: randomUUID(), index: 0, title: '套图', status: 'succeeded', error: null, resultId: third }]), now, now, null);
    db.prepare('INSERT INTO commerce_results VALUES (?, ?, ?, ?, ?, ?, ?)').run(third, commerce, '套图.png', 10, 10, now, project);
    db.prepare('INSERT INTO image_tool_tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(tool, session, second, JSON.stringify({ operation: 'cutout', sourceAssetId: asset }), 'succeeded', 100, JSON.stringify([fourth]), JSON.stringify([image(fourth)]), null, now, now);
    db.prepare('INSERT INTO image_tool_results VALUES (?, ?, ?, ?, ?, ?, ?)').run(fourth, tool, '抠图.png', 10, 10, now, project);
    db.prepare('INSERT INTO agent_executions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(execution, session, plan, project, 'succeeded', 100, JSON.stringify([{ taskId: product }, { taskId: commerce }]), now, now, null);
    db.prepare('INSERT INTO editor_documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(document, first, project, '编辑记录', 10, 10, '#ffffff', JSON.stringify([image(first)]), 0, now, now);
    db.prepare('INSERT INTO creation_scenes VALUES (?, ?, ?, ?, ?, ?)').run(session, JSON.stringify([first, second, fourth].map(resultId => ({ resultId, x: 0, y: 0 }))), JSON.stringify({ x: 0, y: 0, zoom: 1 }), first, 0, now);
    return Promise.all([
      send('/projects/invalid', 'DELETE').then(value => assert.equal(value.status, 400)),
      send(`/projects/${randomUUID()}`, 'DELETE').then(value => assert.equal(value.status, 404)),
      send(`/projects/${other}/results/${first}`, 'DELETE').then(value => assert.equal(value.status, 404)),
      send('/assets/invalid', 'DELETE').then(value => assert.equal(value.status, 400)),
      send(`/assets/${randomUUID()}`, 'DELETE').then(value => assert.equal(value.status, 404))
    ]);
  }).then(() => {
    db.prepare("UPDATE product_image_tasks SET status = 'running' WHERE id = ?").run(product);
    return send(`/projects/${project}/results/${first}`, 'DELETE');
  }).then(value => {
    assert.equal(value.status, 409); assert.equal(count('product_image_results', first), 1); assert.equal(count('editor_documents', document), 1);
    return send(`/assets/${asset}`, 'DELETE');
  }).then(value => {
    assert.equal(value.status, 409); assert.equal(count('product_assets', asset), 1);
    db.prepare("UPDATE product_image_tasks SET status = 'succeeded' WHERE id = ?").run(product);
    db.prepare('INSERT INTO editor_documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(otherDocument, sibling, null, '引用图片', 10, 10, '#ffffff', JSON.stringify([image(first), assetImage(otherAsset)]), 0, now, now);
    return send(`/projects/${project}/results/${first}`, 'DELETE');
  }).then(value => {
    assert.equal(value.status, 409); assert.equal(count('product_image_results', first), 1);
    return send(`/assets/${otherAsset}`, 'DELETE');
  }).then(value => {
    assert.equal(value.status, 409); assert.equal(count('product_assets', otherAsset), 1);
    db.prepare('DELETE FROM editor_documents WHERE id = ?').run(otherDocument);
    return send(`/projects/${project}/results/${first}`, 'DELETE');
  }).then(value => {
    assert.equal(value.status, 200); assert.equal(count('product_image_results', first), 0); assert.equal(count('editor_documents', document), 0);
    assert.equal(count('projects', project), 1); assert.equal(count('agent_sessions', session), 1);
    assert.equal(db.prepare('SELECT content FROM agent_messages WHERE session_id = ?').get(session).content, '单图删除后保留的文字');
    const scene = db.prepare('SELECT * FROM creation_scenes WHERE session_id = ?').get(session);
    assert.equal(scene.selected_id, null); assert.equal(scene.revision, 1); assert.equal(JSON.parse(scene.boards).length, 2);
    return send(`/projects/${project}/results/${fourth}`, 'DELETE');
  }).then(value => {
    assert.equal(value.status, 200); assert.equal(count('image_tool_results', fourth), 0);
    assert.deepEqual(JSON.parse(db.prepare('SELECT output_result_ids FROM image_tool_tasks WHERE id = ?').get(tool).output_result_ids), []);
    return send(`/projects/${project}/results/${third}`, 'DELETE');
  }).then(value => {
    assert.equal(value.status, 200); assert.equal(JSON.parse(db.prepare('SELECT items FROM commerce_tasks WHERE id = ?').get(commerce).items)[0].resultId, null);
    // 共享对话和进行中的规划都必须拒绝整个项目删除，失败不改变任何记录。
    const shared = randomUUID(); db.prepare('INSERT INTO agent_executions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(shared, session, plan, other, 'succeeded', 100, '[]', now, now, null);
    return send(`/projects/${project}`, 'DELETE').then(value => {
      assert.equal(value.status, 409); assert.equal(count('projects', project), 1); assert.equal(count('agent_sessions', session), 1);
      db.prepare('DELETE FROM agent_executions WHERE id = ?').run(shared);
      db.prepare("UPDATE agent_tasks SET status = 'running' WHERE id = ?").run(plan);
      return send(`/projects/${project}`, 'DELETE');
    });
  }).then(value => {
    assert.equal(value.status, 409); assert.equal(count('projects', project), 1);
    db.prepare("UPDATE agent_tasks SET status = 'succeeded' WHERE id = ?").run(plan);
    return send(`/assets/${asset}`, 'DELETE');
  }).then(value => {
    assert.equal(value.status, 200); assert.equal(count('product_assets', asset), 0);
    assert.equal(db.prepare('SELECT source_asset_id FROM product_image_tasks WHERE id = ?').get(product).source_asset_id, null);
    assert.equal(count('product_image_results', second), 1);
    return send(`/projects/${project}/results/${second}`, 'DELETE');
  }).then(value => {
    assert.equal(value.status, 409); assert.match(value.body.message, /最后一张图片/);
    assert.equal(count('projects', project), 1); assert.equal(count('agent_sessions', session), 1); assert.equal(count('product_image_results', second), 1);
    return send(`/projects/${project}/results/${second}`, 'DELETE', { deleteProjectWhenEmpty: 'true' });
  }).then(value => {
    assert.equal(value.status, 400);
    return send(`/projects/${project}/results/${second}`, 'DELETE', { deleteProjectWhenEmpty: true });
  }).then(value => {
    assert.equal(value.status, 200);
    assert.equal(value.body.projectDeleted, true);
    for (const [table, id] of [['projects', project], ['agent_sessions', session], ['agent_tasks', plan], ['agent_executions', execution], ['product_image_results', second], ['product_image_results', sibling], ['image_tool_tasks', tool], ['product_image_tasks', product], ['commerce_tasks', commerce]]) assert.equal(count(table, id), 0, table);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM agent_messages WHERE session_id = ?').get(session).count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM creation_scenes WHERE session_id = ?').get(session).count, 0);
    assert.equal(count('projects', other), 1); assert.equal(count('agent_sessions', otherSession), 1); assert.equal(count('product_assets', otherAsset), 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    return Promise.all([
      send(`/agent/sessions/${session}`).then(value => assert.equal(value.status, 404)),
      send(`/projects/${project}`).then(value => assert.equal(value.status, 404)),
      send(`/product-image/results/${second}`).then(value => assert.equal(value.status, 404)),
      send(`/assets/${asset}`).then(value => assert.equal(value.status, 404))
    ]);
  }).then(() => app.close()).then(start).then(() => {
    assert.equal(count('projects', project), 0); assert.equal(count('agent_sessions', session), 0); assert.equal(count('projects', other), 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  }).finally(() => (app ? app.close() : Promise.resolve()).finally(() => {
    if (original === undefined) delete process.env.PHOTO_STUDIO_DATA_DIR; else process.env.PHOTO_STUDIO_DATA_DIR = original;
    assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`)); assert.ok(basename(directory).startsWith('photo-studio-project-deletion-'));
    rmSync(directory, { recursive: true, force: true });
  }));
});
