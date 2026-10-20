import 'reflect-metadata';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { AuthService } from '../apps/server/dist/auth.service.js';

const [command, username, flag] = process.argv.slice(2);
if (!['create', 'reset-password', 'disable', 'list'].includes(command) || (command !== 'list' && !username) || (flag && (command !== 'create' || flag !== '--admin'))) {
  console.log('用法：npm run accounts -- create <账号> [--admin]\n      npm run accounts -- reset-password <账号>\n      npm run accounts -- disable <账号>\n      npm run accounts -- list\n密码在终端交互输入，不回显、不写入命令历史。首次必须创建管理员，现有数据归该账号。');
  process.exitCode = command === '--help' ? 0 : 1;
} else {
  const auth = new AuthService();
  function password() {
    if (!process.stdin.isTTY) return Promise.reject(new Error('请在交互终端中运行，避免密码进入命令参数或日志。'));
    const output = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    const input = createInterface({ input: process.stdin, output, terminal: true });
    const ask = prompt => new Promise((done, reject) => {
      process.stdout.write(prompt);
      input.once('SIGINT', () => { input.close(); reject(new Error('已取消。')); });
      input.question('', value => { process.stdout.write('\n'); input.removeAllListeners('SIGINT'); done(value); });
    });
    let first;
    return ask('密码（6–30 个字符，不回显）：').then(value => { first = value; return ask('再次输入密码：'); })
      .then(value => { if (value !== first) throw new Error('两次输入的密码不一致。'); return value; })
      .finally(() => input.close());
  }
  Promise.resolve().then(() => {
    if (command === 'list') { console.table(auth.list().map(({ username, role, disabled }) => ({ 账号: username, 角色: role, 已停用: disabled }))); return; }
    if (command === 'disable') { auth.disable(username); console.log('账号已停用，现有登录会话已撤销。'); return; }
    return password().then(value => command === 'create' ? auth.createUser(username, value, flag === '--admin' ? 'admin' : 'member') : auth.resetPassword(username, value))
      .then(() => console.log(command === 'create' ? '账号已创建。' : '密码已重置，原有登录会话已撤销。'));
  }).catch(error => { console.error(error.message); process.exitCode = 1; })
    .finally(() => auth.close());
}
