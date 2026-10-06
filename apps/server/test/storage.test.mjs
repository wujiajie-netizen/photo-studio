import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { StorageService } from '../dist/storage.service.js';

test('SQLite retains written data after reopening and creates isolated runtime directories', () => {
  const directory = mkdtempSync(join(tmpdir(), 'photo-studio-storage-'));
  const originalDirectory = process.env.PHOTO_STUDIO_DATA_DIR;
  process.env.PHOTO_STUDIO_DATA_DIR = directory;
  let storage;
  try {
    storage = new StorageService();
    storage.database.exec('CREATE TABLE fixture (value TEXT NOT NULL) STRICT');
    storage.database.prepare('INSERT INTO fixture (value) VALUES (?)').run('商品项目持久化验收');
    storage.database.prepare('INSERT INTO product_assets VALUES (?, ?, ?, ?, ?, ?, ?)').run('source', '商品原图', 'image/png', 1, 1, 1, '2026-10-06');
    storage.database.prepare('INSERT INTO product_image_tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('task', 'source', '{}', 'succeeded', 100, '2026-10-06', '2026-10-06', null);
    storage.database.prepare('INSERT INTO product_image_results VALUES (?, ?, ?, ?, ?, ?, ?)').run('result', 'task', '原结果.png', 1, 1, '2026-10-06', null);
    // 构造旧版必填素材表，验证真实任务及结果引用迁移后仍保留。
    storage.database.exec(`PRAGMA foreign_keys = OFF; BEGIN;
      CREATE TABLE legacy_tasks (id TEXT PRIMARY KEY NOT NULL, source_asset_id TEXT NOT NULL REFERENCES product_assets(id), parameters TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')), progress INTEGER NOT NULL CHECK(progress BETWEEN 0 AND 100), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT) STRICT;
      INSERT INTO legacy_tasks SELECT * FROM product_image_tasks;
      DROP TABLE product_image_tasks;
      ALTER TABLE legacy_tasks RENAME TO product_image_tasks;
      COMMIT; PRAGMA foreign_keys = ON;`);
    storage.onModuleDestroy();
    storage = new StorageService();
    assert.equal(storage.database.prepare('SELECT value FROM fixture').get().value, '商品项目持久化验收');
    assert.equal(storage.database.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.deepEqual(storage.database.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(storage.database.prepare('SELECT name FROM product_image_results WHERE task_id = ?').get('task').name, '原结果.png');
    assert.equal(storage.database.prepare('SELECT source_asset_id FROM product_image_tasks WHERE id = ?').get('task').source_asset_id, 'source');
    storage.database.prepare('INSERT INTO product_image_tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('text-task', null, '{}', 'succeeded', 100, '2026-10-06', '2026-10-06', null);
    assert.equal(readdirSync(join(directory, 'runs')).filter(name => name.startsWith('before-text-generation-')).length, 1);
    for (const name of ['app.db', 'uploads', 'generated', 'exports', 'runs']) {
      assert.ok(existsSync(join(directory, name)), name);
    }
  } finally {
    if (storage?.database.isOpen) storage.onModuleDestroy();
    if (originalDirectory === undefined) delete process.env.PHOTO_STUDIO_DATA_DIR;
    else process.env.PHOTO_STUDIO_DATA_DIR = originalDirectory;
    // 临时测试目录删除前核对完整路径，确保不触及工作区与真实业务数据。
    assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`));
    assert.ok(basename(directory).startsWith('photo-studio-storage-'));
    rmSync(directory, { recursive: true, force: true });
  }
});
