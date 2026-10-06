import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';

test('project API validates names and retains creation and rename across service restarts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'photo-studio-projects-'));
  const originalDirectory = process.env.PHOTO_STUDIO_DATA_DIR;
  process.env.PHOTO_STUDIO_DATA_DIR = directory;
  let app;
  let base;
  let project;

  function start() {
    return NestFactory.create(AppModule, { logger: false })
      .then((instance) => {
        app = instance;
        app.setGlobalPrefix('api');
        return app.listen(0, '127.0.0.1');
      })
      .then(() => { base = `http://127.0.0.1:${app.getHttpServer().address().port}/api`; });
  }

  function send(path, method = 'GET', body) {
    return fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000)
    }).then((response) => response.json().then((result) => ({ status: response.status, body: result })));
  }

  /* 用临时数据库和随机端口执行真实接口；关闭并重建服务后再读取，验证项目确实落库。 */
  return start()
    .then(() => send('/projects', 'POST', { name: '  春季咖啡上新  ', id: 'client-id', createdAt: 'client-time' }))
    .then(({ status, body }) => {
      assert.equal(status, 201);
      assert.deepEqual(Object.keys(body).sort(), ['createdAt', 'id', 'name', 'updatedAt']);
      assert.match(body.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      assert.equal(body.name, '春季咖啡上新');
      assert.equal(body.createdAt, new Date(body.createdAt).toISOString());
      assert.equal(body.createdAt, body.updatedAt);
      project = body;
      return Promise.all([
        ...[{}, { name: null }, { name: [] }, { name: ' \n ' }, { name: '字'.repeat(81) }, { name: '🛍'.repeat(81) }]
          .map((input) => send('/projects', 'POST', input).then((response) => assert.equal(response.status, 400))),
        send('/projects/not-a-uuid').then((response) => assert.equal(response.status, 400)),
        send(`/projects/${randomUUID()}`).then((response) => assert.equal(response.status, 404))
      ]);
    })
    .then(() => send(`/projects/${project.id}`, 'PATCH', { name: ' 春季咖啡主图 ' }))
    .then(({ status, body }) => {
      assert.equal(status, 200);
      assert.equal(body.name, '春季咖啡主图');
      assert.equal(body.id, project.id);
      assert.equal(body.createdAt, project.createdAt);
      assert.ok(body.updatedAt >= project.updatedAt);
      project = body;
      return send(`/projects/${project.id}`, 'PATCH', { name: '' });
    })
    .then((response) => {
      assert.equal(response.status, 400);
      return send(`/projects/${randomUUID()}`, 'PATCH', { name: '不存在的项目' });
    })
    .then((response) => {
      assert.equal(response.status, 404);
      return send('/projects', 'POST', { name: "春季'; DROP TABLE projects; --" });
    })
    .then(({ status, body }) => {
      assert.equal(status, 201);
      assert.equal(body.name, "春季'; DROP TABLE projects; --");
      return send('/projects', 'POST', { name: '🛍'.repeat(80) });
    })
    .then(({ status, body }) => {
      assert.equal(status, 201);
      assert.equal([...body.name].length, 80);
      return app.close();
    })
    .then(() => start())
    .then(() => Promise.all([send(`/projects/${project.id}`), send('/projects')]))
    .then(([detail, list]) => {
      assert.equal(detail.status, 200);
      assert.deepEqual(detail.body, project);
      assert.equal(list.status, 200);
      assert.equal(list.body.length, 3);
      assert.ok(list.body.some((item) => item.id === project.id && item.name === project.name));
      assert.deepEqual(list.body.map((item) => item.updatedAt), list.body.map((item) => item.updatedAt).sort().reverse());
    })
    .finally(() => (app ? app.close() : Promise.resolve()).finally(() => {
      if (originalDirectory === undefined) delete process.env.PHOTO_STUDIO_DATA_DIR;
      else process.env.PHOTO_STUDIO_DATA_DIR = originalDirectory;
      // 删除前确认测试目录位于系统临时目录内，真实项目数据保持独立。
      assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`));
      assert.ok(basename(directory).startsWith('photo-studio-projects-'));
      rmSync(directory, { recursive: true, force: true });
    }));
});
