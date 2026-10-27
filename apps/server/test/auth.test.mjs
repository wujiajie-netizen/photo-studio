import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { AuthService } from '../dist/auth.service.js';
import { StorageService } from '../dist/storage.service.js';
import { createAuthenticatedApp } from '../dist/authenticated-app.js';

test('Vite proxy preserves the browser origin for login and rejects foreign origins', () => {
  const directory = mkdtempSync(join(tmpdir(), 'photo-studio-auth-proxy-'));
  const auth = new AuthService(directory);
  const publicOrigin = process.env.PHOTO_STUDIO_PUBLIC_ORIGIN;
  delete process.env.PHOTO_STUDIO_PUBLIC_ORIGIN;
  let app; let vite; let base;
  /* 使用真实开发代理和独立账号验证登录，避免仅直连后端漏掉 Host 改写。 */
  return auth.createUser('proxy_admin', '123456', 'admin')
    .then(() => createAuthenticatedApp({ directory, logger: false }))
    .then(instance => { app = instance; return app.listen(0, '127.0.0.1'); })
    .then(() => import('vite'))
    .then(({ createServer, loadConfigFromFile }) => loadConfigFromFile({ command: 'serve', mode: 'development' }, fileURLToPath(new URL('../../web/vite.config.ts', import.meta.url)))
      .then(({ config }) => {
        const proxy = config.server.proxy['/api'];
        const target = `http://127.0.0.1:${app.getHttpServer().address().port}`;
        return createServer({ ...config, configFile: false, root: fileURLToPath(new URL('../../web', import.meta.url)), logLevel: 'silent', server: { ...config.server, host: '127.0.0.1', port: 0, strictPort: false, proxy: { '/api': typeof proxy === 'string' ? target : { ...proxy, target } } } });
      }))
    .then(instance => { vite = instance; return vite.listen(); })
    .then(() => {
      base = `http://127.0.0.1:${vite.httpServer.address().port}`;
      const login = origin => fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Photo-Studio-Request': '1', Origin: origin }, body: JSON.stringify({ username: 'proxy_admin', password: '123456' }), signal: AbortSignal.timeout(5000) });
      return login(base).then(response => {
        assert.equal(response.status, 201); assert.match(response.headers.get('set-cookie'), /HttpOnly/);
        return response.json();
      }).then(body => {
        assert.equal(body.user.username, 'proxy_admin'); return login('https://untrusted.example');
      }).then(response => assert.equal(response.status, 403));
    }).finally(() => {
      if (publicOrigin === undefined) delete process.env.PHOTO_STUDIO_PUBLIC_ORIGIN; else process.env.PHOTO_STUDIO_PUBLIC_ORIGIN = publicOrigin;
      return Promise.all([vite?.close(), app?.close()]).finally(() => {
        auth.close();
        assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`)); assert.ok(basename(directory).startsWith('photo-studio-auth-proxy-'));
        rmSync(directory, { recursive: true, force: true });
      });
    });
});

test('authenticated gateway isolates legacy data, accounts, assets, exports and SSE; restores and revokes sessions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'photo-studio-auth-'));
  const publicOrigin = process.env.PHOTO_STUDIO_PUBLIC_ORIGIN;
  const legacy = new StorageService(directory);
  const projectId = randomUUID(); const sessionId = randomUUID(); const now = new Date().toISOString();
  legacy.database.prepare('INSERT INTO projects VALUES (?, ?, ?, ?)').run(projectId, '原有咖啡项目', now, now);
  legacy.database.prepare('INSERT INTO agent_sessions VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL)').run(sessionId, '原有对话', now, now);
  legacy.onModuleDestroy();
  const auth = new AuthService(directory);
  let app; let base; let administrator; let member; let adminCookie; let memberCookie; let asset;
  let stream; const streamController = new AbortController();
  const resultId = randomUUID(); const taskId = randomUUID();
  const password = 'temporary-test-password-2026';
  const send = (path, method = 'GET', body, cookie, extra = {}) => fetch(`${base}${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Photo-Studio-Request': '1', ...(cookie ? { Cookie: cookie } : {}), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000)
  }).then(response => response.json().then(body => ({ status: response.status, body, cookie: response.headers.get('set-cookie') })));
  return createAuthenticatedApp({ directory, logger: false }).then(instance => {
    app = instance; return app.listen(0, '127.0.0.1');
  }).then(() => {
    base = `http://127.0.0.1:${app.getHttpServer().address().port}/api`;
    return send('/auth/session');
  }).then(response => {
    assert.deepEqual(response.body, { user: null, setupRequired: true });
    return auth.createUser('studio_admin', password, 'admin');
  }).then(user => {
    administrator = user; assert.equal(auth.workspace(user), directory);
    return auth.createUser('studio_member', password, 'member');
  }).then(user => {
    member = user; assert.equal(auth.workspace(user), join(directory, 'users', user.id));
    return Promise.all(['/projects', '/assets', `/agent/sessions/${sessionId}/events`, `/assets/${randomUUID()}/file`, `/editor/results/${resultId}/file`, '/editor/documents', '/brand-presets', '/commerce/tasks'].map(path => send(path).then(result => assert.equal(result.status, 401))));
  }).then(() => send('/auth/login', 'POST', { username: 'studio_admin', password }, undefined, { 'X-Photo-Studio-Request': '' }))
    .then(response => { assert.equal(response.status, 403); return send('/auth/login', 'POST', { username: 'studio_admin', password }, undefined, { Origin: 'https://untrusted.example' }); })
    .then(response => { assert.equal(response.status, 403); return send('/auth/login', 'POST', { username: 'studio_admin', password: 'incorrect' }); })
    .then(response => { assert.equal(response.status, 401); return send('/auth/login', 'POST', { username: 'STUDIO_ADMIN', password }); })
    .then(response => {
      assert.equal(response.status, 201); assert.deepEqual(response.body.user, administrator);
      assert.match(response.cookie, /HttpOnly/); assert.match(response.cookie, /SameSite=Lax/); assert.match(response.cookie, /Path=\/api/);
      adminCookie = response.cookie.split(';')[0];
      const db = new DatabaseSync(join(directory, 'accounts.db'));
      const token = adminCookie.split('=')[1];
      assert.equal(db.prepare('SELECT token_hash FROM login_sessions').get().token_hash, createHash('sha256').update(token).digest('hex'));
      assert.ok(!db.prepare('SELECT password_hash FROM users WHERE id = ?').get(administrator.id).password_hash.includes(password)); db.close();
      return send('/auth/login', 'POST', { username: 'studio_member', password });
    }).then(response => {
      memberCookie = response.cookie.split(';')[0];
      return Promise.all([send('/projects', 'GET', undefined, adminCookie), send('/projects', 'GET', undefined, memberCookie)]);
    }).then(([admin, member]) => {
      assert.equal(admin.status, 200); assert.equal(admin.body[0].id, projectId); assert.deepEqual(member.body, []);
      return Promise.all([
        send(`/projects/${projectId}`, 'GET', undefined, memberCookie),
        send(`/projects/${projectId}`, 'PATCH', { name: '越权修改' }, memberCookie),
        send(`/projects/${projectId}`, 'DELETE', undefined, memberCookie),
        send(`/agent/sessions/${sessionId}/events`, 'GET', undefined, memberCookie),
        send('/codex/status', 'GET', undefined, memberCookie),
        send('/codex/models', 'GET', undefined, memberCookie),
        send('/codex/model', 'PATCH', { model: 'gpt-test' }, memberCookie)
      ]);
    }).then(responses => {
      assert.deepEqual(responses.map(response => response.status), [404, 404, 404, 404, 403, 403, 403]);
      return send('/projects', 'POST', { name: '成员独立项目' }, memberCookie);
    }).then(response => {
      assert.equal(response.status, 201);
      return send(`/projects/${response.body.id}`, 'GET', undefined, adminCookie);
    }).then(response => {
      assert.equal(response.status, 404);
      return sharp({ create: { width: 64, height: 64, channels: 3, background: '#7659ab' } }).png().toBuffer();
    }).then(bytes => {
      const form = new FormData(); form.append('file', new Blob([bytes], { type: 'image/png' }), 'test.png'); form.append('name', '测试素材');
      return fetch(`${base}/assets`, { method: 'POST', headers: { Cookie: adminCookie, 'X-Photo-Studio-Request': '1' }, body: form }).then(response => response.json());
    }).then(value => {
      asset = value; assert.ok(asset.id);
      const database = new DatabaseSync(join(directory, 'app.db'));
      database.prepare('INSERT INTO product_image_tasks VALUES (?, NULL, ?, ?, 100, ?, ?, NULL)').run(taskId, '{}', 'succeeded', now, now);
      database.prepare('INSERT INTO product_image_results VALUES (?, ?, ?, 64, 64, ?, ?)').run(resultId, taskId, '测试作品.png', now, projectId);
      database.close();
      copyFileSync(join(directory, 'uploads', `${asset.id}.png`), join(directory, 'generated', `${resultId}.png`));
      return Promise.all([send(`/assets/${asset.id}/file`, 'GET', undefined, memberCookie), send(`/assets/${asset.id}`, 'DELETE', undefined, memberCookie), send('/assets', 'GET', undefined, memberCookie)]);
    }).then(responses => {
      assert.deepEqual(responses.map(response => response.status), [404, 404, 200]); assert.deepEqual(responses[2].body, []);
      return Promise.all([
        send(`/product-image/results/${resultId}/file`, 'GET', undefined, memberCookie),
        send(`/editor/results/${resultId}/file`, 'GET', undefined, memberCookie),
        send('/editor/documents', 'POST', { resultId }, memberCookie),
        send(`/product-image/tasks/${taskId}/events`, 'GET', undefined, memberCookie),
        send('/CoDeX/status/', 'GET', undefined, memberCookie),
        send('/CoDeX/models/', 'GET', undefined, memberCookie)
      ]);
    }).then(responses => {
      assert.deepEqual(responses.map(response => response.status), [404, 404, 404, 404, 403, 403]);
      return fetch(`${base}/product-image/results/${resultId}/file`, { headers: { Cookie: adminCookie } });
    }).then(response => {
      assert.equal(response.status, 200); return response.arrayBuffer();
    }).then(bytes => {
      assert.deepEqual(Buffer.from(bytes).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      return fetch(`${base}/agent/sessions/${sessionId}/events`, { headers: { Cookie: adminCookie, Accept: 'text/event-stream' }, signal: streamController.signal });
    }).then(response => {
      assert.equal(response.status, 200); stream = response.body.getReader();
      return send('/auth/logout', 'POST', undefined, adminCookie);
    }).then(response => {
      assert.match(response.cookie, /Max-Age=0/);
      const readEnd = () => stream.read().then(value => { if (!value.done) return readEnd(); });
      return Promise.race([readEnd(), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('退出后 SSE 未关闭')), 1500); timer.unref(); })]);
    }).then(() => send('/projects', 'GET', undefined, adminCookie))
    .then(response => { assert.equal(response.status, 401); return app.close(); })
    .then(() => createAuthenticatedApp({ directory, logger: false }))
    .then(instance => { app = instance; return app.listen(0, '127.0.0.1'); })
    .then(() => {
      base = `http://127.0.0.1:${app.getHttpServer().address().port}/api`;
      return send('/auth/session', 'GET', undefined, memberCookie);
    }).then(response => {
      assert.deepEqual(response.body.user, member);
      return send('/projects', 'GET', undefined, `${memberCookie}invalid`);
    }).then(response => {
      assert.equal(response.status, 401);
      return auth.resetPassword('studio_member', 'updated-test-password-2026');
    }).then(() => send('/projects', 'GET', undefined, memberCookie))
    .then(response => {
      assert.equal(response.status, 401); auth.disable('studio_member');
      return send('/auth/login', 'POST', { username: 'studio_member', password: 'updated-test-password-2026' });
    }).then(response => {
      assert.equal(response.status, 401); assert.throws(() => auth.disable('studio_admin'), /最后一个管理员/);
      process.env.PHOTO_STUDIO_PUBLIC_ORIGIN = 'https://studio.example.test';
      return fetch(`${base}/auth/session`);
    }).then(response => {
      assert.equal(response.headers.get('strict-transport-security'), 'max-age=86400');
      return send('/auth/login', 'POST', { username: 'studio_admin', password }, undefined, { Origin: 'https://studio.example.test' });
    }).then(response => {
      assert.equal(response.status, 201); assert.match(response.cookie, /; Secure/);
      adminCookie = response.cookie.split(';')[0];
      const database = new DatabaseSync(join(directory, 'accounts.db'));
      database.prepare('UPDATE login_sessions SET expires_at = ?').run(Date.now() - 1); database.close();
      return send('/projects', 'GET', undefined, adminCookie);
    }).then(response => assert.equal(response.status, 401))
    .finally(() => {
      if (publicOrigin === undefined) delete process.env.PHOTO_STUDIO_PUBLIC_ORIGIN; else process.env.PHOTO_STUDIO_PUBLIC_ORIGIN = publicOrigin;
      streamController.abort(); return app?.close().finally(() => {
        auth.close();
        assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`)); assert.ok(basename(directory).startsWith('photo-studio-auth-'));
        rmSync(directory, { recursive: true, force: true });
      });
    });
});

test('account setup, duplicate usernames, password validation and login throttling fail safely', () => {
  const directory = mkdtempSync(join(tmpdir(), 'photo-studio-auth-limits-'));
  const auth = new AuthService(directory);
  return assert.rejects(auth.createUser('member', 'valid-test-password', 'member'), /先创建管理员/)
    .then(() => assert.rejects(auth.createUser('../admin', 'valid-test-password', 'admin'), /账号须/))
    .then(() => assert.rejects(auth.createUser('admin', 'short', 'admin'), /密码须/))
    .then(() => assert.rejects(auth.createUser('admin', 'a'.repeat(31), 'admin'), /密码须/))
    .then(() => auth.createUser('admin', '123456', 'admin'))
    .then(() => auth.login({ username: 'admin', password: '123456' }, 'test-address'))
    .then(() => assert.rejects(auth.resetPassword('admin', 'short'), /密码须/))
    .then(() => assert.rejects(auth.resetPassword('admin', 'a'.repeat(31)), /密码须/))
    .then(() => auth.resetPassword('admin', 'a'.repeat(30)))
    .then(() => auth.login({ username: 'admin', password: 'a'.repeat(30) }, 'test-address'))
    .then(() => auth.createUser('member', 'b'.repeat(30), 'member'))
    .then(() => auth.resetPassword('member', '654321'))
    .then(() => auth.login({ username: 'member', password: '654321' }, 'test-address'))
    .then(() => {
      assert.throws(() => auth.login({ username: 'admin', password: 'short' }, 'test-address'), /格式不正确/);
      assert.throws(() => auth.login({ username: 'admin', password: 'a'.repeat(31) }, 'test-address'), /格式不正确/);
    })
    .then(() => assert.rejects(auth.createUser('ADMIN', 'valid-test-password', 'admin'), /账号已存在/))
    .then(() => {
      let attempts = Promise.resolve();
      for (let index = 0; index < 8; index++) attempts = attempts.then(() => assert.rejects(Promise.resolve().then(() => auth.login({ username: 'admin', password: 'wrong-password' }, 'test-address')), /账号或密码不正确/));
      return attempts;
    }).then(() => assert.throws(() => auth.login({ username: 'admin', password: 'a'.repeat(30) }, 'test-address'), /登录尝试过多/))
    .finally(() => {
      auth.close();
      assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`)); assert.ok(basename(directory).startsWith('photo-studio-auth-limits-'));
      rmSync(directory, { recursive: true, force: true });
    });
});
