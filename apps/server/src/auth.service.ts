import { BadRequestException, ConflictException, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AuthUser } from '@photo-studio/shared';

const lifetime = 7 * 24 * 60 * 60 * 1000;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const derive = (password: string, salt: string): Promise<Buffer> => new Promise((done, reject) => {
  scrypt(password, salt, 64, (error, key) => { if (error) reject(error); else done(key); });
});
type UserRow = AuthUser & { password_hash: string; disabled: number; legacy_data: number };

@Injectable()
export class AuthService {
  readonly directory: string;
  private readonly database: DatabaseSync;

  constructor(directory = resolve(process.env.PHOTO_STUDIO_DATA_DIR || resolve(__dirname, '../../../data'))) {
    this.directory = resolve(directory);
    mkdirSync(this.directory, { recursive: true });
    this.database = new DatabaseSync(resolve(this.directory, 'accounts.db'), { timeout: 5000 });
    this.database.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY NOT NULL, username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
        disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0, 1)),
        legacy_data INTEGER UNIQUE CHECK(legacy_data = 1), created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS login_sessions (
        token_hash TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
        expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS login_sessions_user ON login_sessions(user_id);
      CREATE TABLE IF NOT EXISTS login_attempts (
        key TEXT PRIMARY KEY NOT NULL, failures INTEGER NOT NULL, resets_at INTEGER NOT NULL
      ) STRICT;`);
  }

  setupRequired(): boolean { return !this.database.prepare('SELECT id FROM users LIMIT 1').get(); }

  user(token: string | undefined): AuthUser | null {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const row = this.database.prepare(`SELECT u.id, u.username, u.role FROM login_sessions s
      JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0`).get(digest(token), Date.now());
    return row ? row as unknown as AuthUser : null;
  }

  workspace(user: AuthUser): string {
    const row = this.database.prepare('SELECT legacy_data FROM users WHERE id = ?').get(user.id);
    if (!row) throw new UnauthorizedException('登录已失效，请重新登录。');
    return row.legacy_data === 1 ? this.directory : resolve(this.directory, 'users', user.id);
  }

  login(input: unknown, address: string): Promise<{ user: AuthUser; token: string }> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('请输入账号和密码。');
    const { username, password } = input as Record<string, unknown>;
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_-]{3,32}$/.test(username.trim()) || typeof password !== 'string' || password.length < 6 || password.length > 30) throw new BadRequestException('账号或密码格式不正确。');
    const name = username.trim().toLowerCase(); const now = Date.now();
    this.database.prepare('DELETE FROM login_attempts WHERE resets_at <= ?').run(now);
    this.database.prepare('DELETE FROM login_sessions WHERE expires_at <= ?').run(now);
    const keys = [`account:${digest(name)}`, `address:${digest(address)}`];
    if (keys.some((key, index) => {
      const row = this.database.prepare('SELECT failures FROM login_attempts WHERE key = ?').get(key);
      return row && Number(row.failures) >= (index === 0 ? 8 : 40);
    })) throw new HttpException('登录尝试过多，请 15 分钟后再试。', 429);
    const row = this.database.prepare('SELECT * FROM users WHERE username = ?').get(name) as unknown as UserRow | undefined;
    const [salt, expected] = row ? row.password_hash.split(':') : ['photo-studio-unavailable-account', '0'.repeat(128)];
    /* 不存在的账号也执行密码派生；错误统一返回，限制同账号和同来源的连续尝试。 */
    return derive(password, salt).then(key => {
      if (!row || row.disabled || !timingSafeEqual(key, Buffer.from(expected, 'hex'))) {
        for (const attempt of keys) this.database.prepare(`INSERT INTO login_attempts VALUES (?, 1, ?)
          ON CONFLICT(key) DO UPDATE SET failures = failures + 1`).run(attempt, now + 15 * 60 * 1000);
        throw new UnauthorizedException('账号或密码不正确。');
      }
      this.database.prepare('DELETE FROM login_attempts WHERE key = ?').run(keys[0]);
      const token = randomBytes(32).toString('base64url');
      this.database.prepare('INSERT INTO login_sessions VALUES (?, ?, ?)').run(digest(token), row.id, Date.now() + lifetime);
      return { user: { id: row.id, username: row.username, role: row.role }, token };
    });
  }

  logout(token: string | undefined): void {
    if (token) this.database.prepare('DELETE FROM login_sessions WHERE token_hash = ?').run(digest(token));
  }

  createUser(username: string, password: string, role: AuthUser['role']): Promise<AuthUser> {
    const name = username.trim().toLowerCase();
    if (!/^[a-z0-9_-]{3,32}$/.test(name)) return Promise.reject(new BadRequestException('账号须为 3–32 位英文字母、数字、下划线或短横线。'));
    if (password.length < 6 || password.length > 30) return Promise.reject(new BadRequestException('密码须为 6–30 个字符。'));
    if (!['admin', 'member'].includes(role)) return Promise.reject(new BadRequestException('账号角色无效。'));
    if (this.setupRequired() && role !== 'admin') return Promise.reject(new BadRequestException('请先创建管理员账号。'));
    const salt = randomBytes(32).toString('hex');
    return derive(password, salt).then(hash => {
      this.database.exec('BEGIN IMMEDIATE');
      try {
        if (this.database.prepare('SELECT id FROM users WHERE username = ?').get(name)) throw new ConflictException('账号已存在。');
        const first = this.setupRequired();
        if (first && role !== 'admin') throw new BadRequestException('请先创建管理员账号。');
        const user: AuthUser = { id: randomUUID(), username: name, role };
        this.database.prepare('INSERT INTO users VALUES (?, ?, ?, ?, 0, ?, ?)').run(user.id, name, `${salt}:${hash.toString('hex')}`, role, first ? 1 : null, new Date().toISOString());
        this.database.exec('COMMIT');
        return user;
      } catch (error) { this.database.exec('ROLLBACK'); throw error; }
    });
  }

  resetPassword(username: string, password: string): Promise<void> {
    if (password.length < 6 || password.length > 30) return Promise.reject(new BadRequestException('密码须为 6–30 个字符。'));
    const row = this.database.prepare('SELECT id FROM users WHERE username = ?').get(username.trim().toLowerCase());
    if (!row) return Promise.reject(new BadRequestException('账号不存在。'));
    const salt = randomBytes(32).toString('hex');
    return derive(password, salt).then(hash => {
      this.database.exec('BEGIN IMMEDIATE');
      try {
        this.database.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(`${salt}:${hash.toString('hex')}`, row.id);
        this.database.prepare('DELETE FROM login_sessions WHERE user_id = ?').run(row.id);
        this.database.prepare('DELETE FROM login_attempts WHERE key = ?').run(`account:${digest(username.trim().toLowerCase())}`);
        this.database.exec('COMMIT');
      } catch (error) { this.database.exec('ROLLBACK'); throw error; }
    });
  }

  list(): (AuthUser & { disabled: boolean })[] {
    return this.database.prepare('SELECT id, username, role, disabled FROM users ORDER BY created_at, id').all().map(row => ({ ...row, disabled: row.disabled === 1 })) as (AuthUser & { disabled: boolean })[];
  }

  disable(username: string): void {
    const user = this.list().find(item => item.username === username.trim().toLowerCase());
    if (!user) throw new BadRequestException('账号不存在。');
    if (user.role === 'admin' && !this.list().some(item => item.role === 'admin' && !item.disabled && item.id !== user.id)) throw new BadRequestException('不能停用最后一个管理员。');
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(user.id);
      this.database.prepare('DELETE FROM login_sessions WHERE user_id = ?').run(user.id);
      this.database.exec('COMMIT');
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }

  close(): void { this.database.close(); }
}
