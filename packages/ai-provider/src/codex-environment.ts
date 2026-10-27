import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, join, resolve } from 'node:path';
import type { CodexModelOption, CodexStatus } from '@photo-studio/shared';

export function findCodexExecutable(): string | null {
  if (process.env.PHOTO_STUDIO_CODEX_PATH) return resolve(process.env.PHOTO_STUDIO_CODEX_PATH);
  const target = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  for (const directory of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const native = join(directory, process.platform === 'win32' ? 'codex.exe' : 'codex');
    if (existsSync(native)) return native;
    if (process.platform !== 'win32') continue;
    /* Windows 的 npm 命令是脚本；定位官方包的原生程序，避免通过 Shell 拼接命令和参数。 */
    const packageFile = join(directory, 'node_modules/@openai/codex/package.json');
    if (!existsSync(packageFile)) continue;
    const packageRequire = createRequire(packageFile);
    let vendor = join(dirname(packageFile), 'vendor');
    try {
      vendor = join(dirname(packageRequire.resolve(`@openai/codex-win32-${process.arch}/package.json`)), 'vendor');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw error;
    }
    const executable = join(vendor, `${target}-pc-windows-msvc/bin/codex.exe`);
    if (existsSync(executable)) return executable;
  }
  return null;
}

function runInspection(executable: string, args: string[]): Promise<{ code: number; text: string }> {
  return new Promise((resolveInspection, reject) => {
    execFile(executable, args, { timeout: 4000, maxBuffer: 256 * 1024, windowsHide: true, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error && (typeof error.code !== 'number' || error.killed)) { reject(error); return; }
      resolveInspection({ code: error?.code as number ?? 0, text: `${stdout}\n${stderr}`.trim() });
    });
  });
}

export function inspectCodex(): Promise<CodexStatus> {
  let version: string | null = null;
  /* 检测只运行版本、帮助和登录状态；不调用模型、不读取凭据，也不把原始输出发送到页面。 */
  return Promise.resolve()
    .then(() => {
      const executable = findCodexExecutable();
      if (!executable) return { status: 'missing', version, message: '未找到 Codex CLI，请安装后刷新状态。' } satisfies CodexStatus;
      return runInspection(executable, ['--version'])
        .then((result) => {
          const match = /^codex-cli (\S+)$/m.exec(result.text);
          if (result.code !== 0 || !match) throw new Error('version');
          version = match[1];
          return Promise.all([runInspection(executable, ['login', 'status']), runInspection(executable, ['exec', '--help'])]);
        })
        .then(([login, help]): CodexStatus => {
          if (login.code !== 0 && /^Not logged in$/m.test(login.text)) return { status: 'not_logged_in', version, message: 'Codex 尚未登录，请在本机登录后刷新状态。' };
          if (login.code !== 0) throw new Error('login');
          if (!/^Logged in using ChatGPT$/m.test(login.text)) return { status: 'unsupported', version, message: '当前认证方式不符合项目要求，请使用 ChatGPT 登录 Codex。' };
          if (help.code !== 0 || !['--json', '--output-schema', '--ignore-user-config', '--ignore-rules'].every((flag) => help.text.includes(flag))) return { status: 'unsupported', version, message: '当前 CLI 缺少所需接入能力，请更新 Codex 后刷新状态。' };
          return { status: 'ready', version, message: '已通过 ChatGPT 登录；实际模型调用结果将在任务中显示。' };
        });
    })
    .catch((error: NodeJS.ErrnoException): CodexStatus => ({
      status: error.code === 'ENOENT' ? 'missing' : 'error',
      version,
      message: error.code === 'ENOENT' ? '未找到 Codex CLI，请检查安装位置后刷新状态。' : '无法完成 Codex 检测，请检查本机 CLI 后重试。'
    }));
}

export function listCodexModels(): Promise<CodexModelOption[]> {
  /* 仅通过 app-server 协议读取可见目录；不发起推理，也不把配置和凭据返回业务层。 */
  return inspectCodex().then(status => {
    if (status.status !== 'ready') throw new Error(status.message);
    const executable = findCodexExecutable();
    if (!executable) throw new Error('未找到 Codex CLI。');
    const args = ['app-server', '--stdio', '-c', 'features.plugins=false', '-c', 'features.apps=false', '-c', 'features.remote_control=false'];
    const env = { ...process.env }; delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY;
    const child = spawn(executable, args, { env, shell: false, windowsHide: true });
    return new Promise<CodexModelOption[]>((resolveModels, reject) => {
      let settled = false; let buffer = ''; let bytes = 0;
      const finish = (error?: Error, models?: CodexModelOption[]) => {
        if (settled) return; settled = true; clearTimeout(timeout); child.kill();
        if (error) reject(error); else resolveModels(models!);
      };
      const send = (value: unknown) => child.stdin.write(`${JSON.stringify(value)}\n`);
      const timeout = setTimeout(() => finish(new Error('读取 Codex 模型列表超时，请稍后重试。')), 10_000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        if (settled) return;
        bytes += Buffer.byteLength(chunk); buffer += chunk;
        if (bytes > 2 * 1024 * 1024) { finish(new Error('Codex 模型列表超过限制。')); return; }
        try {
          for (let at; (at = buffer.indexOf('\n')) !== -1;) {
            const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
            if (!line.trim()) continue;
            const event = JSON.parse(line) as { id?: number; result?: { data?: unknown[] }; error?: unknown };
            if (event.id === 1 && event.result) {
              send({ method: 'initialized', params: {} });
              send({ id: 2, method: 'model/list', params: { includeHidden: false, limit: 100 } });
            } else if (event.id === 2) {
              if (event.error || !Array.isArray(event.result?.data)) { finish(new Error('Codex 无法返回可用模型，请稍后重试。')); return; }
              const models = event.result.data.map(value => {
                const item = value as Record<string, unknown>;
                return { id: item.model, displayName: item.displayName, description: item.description, isDefault: item.isDefault };
              }).filter((item): item is CodexModelOption => typeof item.id === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(item.id) && typeof item.displayName === 'string' && typeof item.description === 'string' && typeof item.isDefault === 'boolean');
              if (!models.length) { finish(new Error('Codex 当前没有可选择的模型。')); return; }
              finish(undefined, models);
            }
          }
        } catch { finish(new Error('无法读取 Codex 模型列表，请检查 CLI 版本后重试。')); }
      });
      child.stdin.on('error', () => finish(new Error('无法向 Codex 请求模型列表。')));
      child.once('error', () => finish(new Error('无法启动 Codex，请检查本机安装。')));
      child.once('close', () => { if (!settled) finish(new Error('Codex 模型列表连接意外结束，请重试。')); });
      send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'photo_studio', title: 'Photo Studio', version: '0.1.0' }, capabilities: { experimentalApi: true } } });
    });
  });
}
