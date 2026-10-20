import 'reflect-metadata';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), '..');
const directory = resolve(root, 'data/deployment');
const recordPath = resolve(directory, 'online-process.json');
const stopPath = resolve(directory, 'online.stop');
const statusPath = resolve(directory, 'status.json');
const port = 3199;

if (process.argv.includes('--transport')) {
  const socket = createConnection({ host: 'localhost.run', port: 22 });
  socket.on('connect', () => { process.stdin.pipe(socket); socket.pipe(process.stdout); });
  socket.on('error', error => { console.error(error.message); process.exitCode = 1; });
  process.stdin.on('end', () => socket.end());
} else if (process.argv.includes('--server')) {
  import('../apps/server/dist/authenticated-app.js').then(({ createAuthenticatedApp }) => createAuthenticatedApp())
    .then(app => {
      process.once('message', message => {
        if (message === 'shutdown') app.close().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
      });
      return app.listen(port, '127.0.0.1');
    }).catch(error => { console.error(error); process.exitCode = 1; process.disconnect?.(); });
} else {
  mkdirSync(directory, { recursive: true });
  let tunnel; let server; let tunnelRetry; let serverRetry; let origin; let stopping = false; let reconnecting = false;
  const status = state => writeFileSync(statusPath, JSON.stringify({ state, url: origin ?? null, port, updatedAt: new Date().toISOString() }, null, 2));
  const closeServer = () => new Promise(done => {
    const child = server; server = undefined;
    if (!child || child.exitCode !== null || child.signalCode !== null) { done(); return; }
    const timeout = setTimeout(() => child.kill(), 15000);
    child.once('exit', () => { clearTimeout(timeout); done(); });
    if (child.connected) child.send('shutdown'); else child.kill();
  });
  const stop = () => {
    if (stopping) return;
    stopping = true; clearTimeout(tunnelRetry); clearTimeout(serverRetry); clearInterval(watchStop); tunnel?.kill();
    status('stopping');
    closeServer().finally(() => { rmSync(recordPath, { force: true }); rmSync(stopPath, { force: true }); status('stopped'); });
  };
  const watchStop = setInterval(() => { if (existsSync(stopPath)) stop(); }, 1000);
  const startServer = () => {
    if (stopping) return;
    server = spawn(process.execPath, [script, '--server'], { cwd: root, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, PHOTO_STUDIO_PUBLIC_ORIGIN: origin } });
    server.on('error', error => console.error('服务启动失败：', error.message));
    server.on('exit', () => {
      if (stopping || reconnecting) return;
      status('restarting'); serverRetry = setTimeout(startServer, 5000);
    });
    status('running'); console.log(`公网入口：${origin}`);
  };
  const connect = () => {
    if (stopping) return;
    status('connecting');
    const ssh = resolve(process.env.SystemRoot || 'C:/Windows', 'System32/OpenSSH/ssh.exe');
    const args = ['-F', 'none', '-T', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none', '-o', 'IdentityFile=none', '-o', 'PreferredAuthentications=none', '-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${resolve(directory, 'known_hosts').replaceAll('\\', '/')}`, '-o', `ProxyCommand="${process.execPath}" "${script}" --transport`, '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3', '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=20', '-R', `80:127.0.0.1:${port}`, 'nokey@localhost.run', '--', '--output', 'json', '--inject-http-proxy-headers'];
    tunnel = spawn(ssh, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] });
    let buffer = '';
    /* 免费隧道重连可能更换域名；先关闭旧服务，再用新来源启动，保持 Secure Cookie 和来源校验。 */
    tunnel.stdout.on('data', chunk => {
      buffer += chunk.toString();
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event.type !== 'v1.tcpip_forward.register.accepted') continue;
        const nextOrigin = typeof event.data === 'string' ? event.data.match(/https:\/\/[a-z0-9.-]+\.(?:lhr\.life|localhost\.run)/)?.[0] : undefined;
        if (!nextOrigin) continue;
        if (nextOrigin === origin && server) { status('running'); continue; }
        reconnecting = true; clearTimeout(serverRetry);
        closeServer().then(() => { origin = nextOrigin; reconnecting = false; startServer(); });
      }
    });
    tunnel.on('error', error => console.error('隧道启动失败：', error.message));
    tunnel.on('exit', () => {
      if (stopping) return;
      status('disconnected'); tunnelRetry = setTimeout(connect, 10000);
    });
  };
  const checkPort = value => new Promise((done, reject) => {
    const socket = createServer(); socket.once('error', () => reject(new Error(`端口 ${value} 已被占用，请先停止本地开发或旧部署。`)));
    socket.listen(value, '127.0.0.1', () => socket.close(done));
  });
  Promise.resolve().then(() => {
    if (existsSync(recordPath)) {
      const record = JSON.parse(readFileSync(recordPath, 'utf8'));
      try { process.kill(record.pid, 0); } catch (error) { if (error.code !== 'ESRCH') throw error; rmSync(recordPath); }
      if (existsSync(recordPath)) throw new Error('线上服务已运行，请先执行 scripts/stop-online.ps1。');
    }
    if (!existsSync(resolve(root, 'apps/web/dist/index.html')) || !existsSync(resolve(root, 'apps/server/dist/authenticated-app.js'))) throw new Error('请先执行 npm run build。');
    const database = new DatabaseSync(resolve(process.env.PHOTO_STUDIO_DATA_DIR || resolve(root, 'data'), 'accounts.db'), { readOnly: true });
    try {
      if (database.prepare('PRAGMA quick_check').all().some(row => row.quick_check !== 'ok')) throw new Error('账号数据库检查失败，请先恢复数据。');
      if (!database.prepare("SELECT id FROM users WHERE role = 'admin' AND disabled = 0 LIMIT 1").get()) throw new Error('请先创建管理员账号。');
    } finally { database.close(); }
    return Promise.all([checkPort(3000), checkPort(5173), checkPort(port)]);
  }).then(() => {
    rmSync(stopPath, { force: true });
    writeFileSync(recordPath, JSON.stringify({ pid: process.pid, root, script, startedAt: Date.now() - process.uptime() * 1000 }));
    process.once('SIGINT', stop); process.once('SIGTERM', stop); connect();
  }).catch(error => { console.error(error.message); clearInterval(watchStop); process.exitCode = 1; });
}
