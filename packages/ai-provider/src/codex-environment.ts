import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, join, resolve } from 'node:path';
import type { CodexStatus } from '@photo-studio/shared';

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
