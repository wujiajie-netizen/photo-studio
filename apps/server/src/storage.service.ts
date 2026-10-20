import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

@Injectable()
export class StorageService implements OnModuleDestroy {
  readonly dataDirectory: string;
  readonly database: DatabaseSync;
  readonly beforeClose: (() => Promise<void>)[] = [];

  constructor(@Optional() @Inject('PHOTO_STUDIO_DATA_DIRECTORY') directory?: string) {
    this.dataDirectory = resolve(directory || process.env.PHOTO_STUDIO_DATA_DIR || resolve(__dirname, '../../../data'));
    for (const directory of ['', 'uploads', 'generated', 'exports', 'runs']) {
      mkdirSync(resolve(this.dataDirectory, directory), { recursive: true });
    }
    this.database = new DatabaseSync(resolve(this.dataDirectory, 'app.db'), { timeout: 5000 });
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT
    `);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS agent_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        provider_session_id TEXT,
        pinned_at TEXT,
        deleted_at TEXT,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS agent_messages (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL REFERENCES agent_sessions(id),
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS agent_tasks (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL REFERENCES agent_sessions(id),
        status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        error TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS agent_messages_session ON agent_messages(session_id, created_at);
      CREATE INDEX IF NOT EXISTS agent_tasks_session ON agent_tasks(session_id, created_at);
      CREATE TABLE IF NOT EXISTS product_assets (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS product_image_tasks (
        id TEXT PRIMARY KEY NOT NULL,
        source_asset_id TEXT REFERENCES product_assets(id),
        parameters TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
        progress INTEGER NOT NULL CHECK(progress BETWEEN 0 AND 100),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        error TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS product_image_results (
        id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL REFERENCES product_image_tasks(id),
        name TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        project_id TEXT REFERENCES projects(id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS product_results_task ON product_image_results(task_id, created_at);
      CREATE INDEX IF NOT EXISTS product_results_project ON product_image_results(project_id, created_at);
      CREATE TABLE IF NOT EXISTS commerce_tasks (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('product-kit', 'detail-page')),
        parameters TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
        progress INTEGER NOT NULL CHECK(progress BETWEEN 0 AND 100),
        items TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        error TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS commerce_results (
        id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL REFERENCES commerce_tasks(id),
        name TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        project_id TEXT REFERENCES projects(id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS commerce_results_task ON commerce_results(task_id, created_at);
      CREATE INDEX IF NOT EXISTS commerce_results_project ON commerce_results(project_id, created_at);
      CREATE TABLE IF NOT EXISTS editor_documents (
        id TEXT PRIMARY KEY NOT NULL,
        result_id TEXT UNIQUE NOT NULL,
        project_id TEXT REFERENCES projects(id),
        name TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        background TEXT NOT NULL,
        layers TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS creation_scenes (
        session_id TEXT PRIMARY KEY NOT NULL REFERENCES agent_sessions(id),
        boards TEXT NOT NULL,
        viewport TEXT NOT NULL,
        selected_id TEXT,
        revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS agent_executions (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL REFERENCES agent_sessions(id),
        plan_task_id TEXT NOT NULL REFERENCES agent_tasks(id),
        project_id TEXT NOT NULL REFERENCES projects(id),
        status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
        progress INTEGER NOT NULL CHECK(progress BETWEEN 0 AND 100),
        steps TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        error TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS agent_executions_plan ON agent_executions(plan_task_id, created_at);
      CREATE TABLE IF NOT EXISTS image_tool_tasks (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL REFERENCES agent_sessions(id),
        result_id TEXT NOT NULL,
        input TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
        progress INTEGER NOT NULL CHECK(progress BETWEEN 0 AND 100),
        output_result_ids TEXT NOT NULL,
        output_layers TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS image_tools_session ON image_tool_tasks(session_id, created_at);
      CREATE TABLE IF NOT EXISTS image_tool_results (
        id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL REFERENCES image_tool_tasks(id),
        name TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        project_id TEXT REFERENCES projects(id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS image_tool_results_project ON image_tool_results(project_id, created_at);
      CREATE TABLE IF NOT EXISTS brand_presets (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
        style TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS creation_presets (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
        kind TEXT NOT NULL CHECK(kind IN ('product-image', 'product-kit', 'detail-page')),
        parameters TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `);
    /* 旧会话补充可空的管理字段和默认项目，不改动消息、任务、作品及其引用。 */
    const sessionColumns = this.database.prepare('PRAGMA table_info(agent_sessions)').all();
    const missingSessionColumns = ['pinned_at', 'deleted_at'].filter(name => !sessionColumns.some(column => column.name === name));
    if (missingSessionColumns.length) {
      this.database.exec('BEGIN IMMEDIATE;');
      try {
        missingSessionColumns.forEach(name => this.database.exec(`ALTER TABLE agent_sessions ADD COLUMN ${name} TEXT;`));
        this.database.exec('COMMIT;');
      } catch (error) { this.database.exec('ROLLBACK;'); throw error; }
    }
    if (!sessionColumns.some(column => column.name === 'project_id')) this.database.exec('ALTER TABLE agent_sessions ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;');
    /* 旧库只放宽素材列；迁移前保存完整 SQLite 快照，事务内保留原任务和结果引用。 */
    if (this.database.prepare('PRAGMA table_info(product_image_tasks)').all().some(column => column.name === 'source_asset_id' && column.notnull === 1)) {
      const backup = resolve(this.dataDirectory, 'runs', `before-text-generation-${Date.now()}.db`);
      this.database.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
      this.database.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;');
      try {
        this.database.exec(`CREATE TABLE product_image_tasks_new (
          id TEXT PRIMARY KEY NOT NULL, source_asset_id TEXT REFERENCES product_assets(id), parameters TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
          progress INTEGER NOT NULL CHECK(progress BETWEEN 0 AND 100), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT
        ) STRICT;
        INSERT INTO product_image_tasks_new SELECT * FROM product_image_tasks;
        DROP TABLE product_image_tasks;
        ALTER TABLE product_image_tasks_new RENAME TO product_image_tasks;`);
        if (this.database.prepare('PRAGMA foreign_key_check').all().length) throw new Error('素材可选迁移未通过引用检查。');
        this.database.exec('COMMIT;');
      } catch (error) { this.database.exec('ROLLBACK;'); throw error; }
      finally { this.database.exec('PRAGMA foreign_keys = ON;'); }
    }
  }

  onModuleDestroy() {
    if (this.beforeClose.length) return Promise.all(this.beforeClose.map((close) => close())).then(() => this.database.close());
    this.database.close();
  }
}
