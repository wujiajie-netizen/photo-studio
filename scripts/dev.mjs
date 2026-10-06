import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const recordPath = resolve(root, 'data/dev-process.json');
const children = [];
let stopping = false;

function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue;
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  }
  rmSync(recordPath, { force: true });
  process.exitCode = code;
}

function launch(args, pipeOutput = false) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: ['inherit', pipeOutput ? 'pipe' : 'inherit', 'inherit'], windowsHide: true });
  children.push(child);
  child.on('error', (error) => {
    console.error('启动失败：', error.message);
    stop(1);
  });
  child.on('exit', (code) => {
    if (!stopping) stop(code || 1);
  });
  return child;
}

function checkPort(port) {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`端口 ${port} 已被占用，请先停止占用的服务。`)));
    server.listen(port, '127.0.0.1', () => server.close(resolvePort));
  });
}

function waitForService(attempt = 0) {
  return fetch('http://127.0.0.1:3000/api/health', { signal: AbortSignal.timeout(1000) })
    .then((response) => {
      if (!response.ok) throw new Error('本地服务尚未就绪。');
    })
    .catch((error) => {
      if (attempt >= 50 || stopping) throw error;
      return new Promise((resolveWait) => setTimeout(resolveWait, 100)).then(() => waitForService(attempt + 1));
    });
}

/* 先检查进程记录和两个端口；任何子服务退出时统一清理，避免只启动一半或留下后台进程。 */
Promise.resolve()
  .then(() => {
    mkdirSync(resolve(root, 'data'), { recursive: true });
    let existing;
    try {
      existing = JSON.parse(readFileSync(recordPath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (existing) {
      try {
        process.kill(existing.pid, 0);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
        rmSync(recordPath);
        return;
      }
      throw new Error('工作台已在运行，请先使用 scripts/stop.ps1 停止。');
    }
  })
  .then(() => Promise.all([checkPort(3000), checkPort(5173)]))
  .then(() => {
    writeFileSync(recordPath, JSON.stringify({ pid: process.pid, root, script: fileURLToPath(import.meta.url), startedAt: Date.now() - process.uptime() * 1000 }), 'utf8');
    const compiler = require.resolve('typescript/bin/tsc');
    process.once('SIGINT', () => stop(0));
    process.once('SIGTERM', () => stop(0));
    /* 首次编译完成后再启动服务，健康检查通过后开放前端，避免首页误报连接失败。 */
    return new Promise((resolveCompile, reject) => {
      const watcher = launch([compiler, '--watch', '--pretty', 'false', '--preserveWatchOutput', '-p', 'apps/server/tsconfig.json'], true);
      let initialOutput = '';
      let initialized = false;
      watcher.stdout.on('data', (chunk) => {
        process.stdout.write(chunk);
        if (initialized) return;
        initialOutput += chunk.toString();
        if (!initialOutput.includes('Watching for file changes.')) return;
        initialized = true;
        if (initialOutput.includes('Found 0 errors.')) resolveCompile();
        else reject(new Error('服务编译失败，请修复上方错误后重新启动。'));
      });
    });
  })
  .then(() => {
    if (stopping) throw new Error('启动已取消。');
    launch(['--watch', 'apps/server/dist/main.js']);
    return waitForService();
  })
  .then(() => {
    if (stopping) throw new Error('启动已取消。');
    const vite = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
    launch([vite, '--host', '127.0.0.1', '--config', 'apps/web/vite.config.ts', 'apps/web']);
    console.log('\nPhoto Studio: http://127.0.0.1:5173\n按 Ctrl+C 停止，或运行 scripts/stop.ps1。\n');
  })
  .catch((error) => {
    console.error(error.message);
    if (children.length) stop(1);
    else process.exitCode = 1;
  });
