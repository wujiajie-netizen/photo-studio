import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { appendFileSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { findCodexExecutable, inspectCodex } from './codex-environment';
import type { AgentEvent, AgentInput, AgentModelProvider, LocalImageInput, LocalImageOutput } from './model-provider';
import { CodexImageRunner } from './codex-image-runner';
import { LocalImageRunner } from './local-image-runner';

export class CodexCliProvider implements AgentModelProvider {
  private readonly active = new Map<string, { child: ChildProcessWithoutNullStreams; cancel: () => void; closed: Promise<void> }>();
  private readonly preparing = new Map<string, () => void>();

  private readonly images: CodexImageRunner;
  private readonly localImages: LocalImageRunner;
  constructor(private readonly runsDirectory: string) { this.images = new CodexImageRunner(runsDirectory); this.localImages = new LocalImageRunner(runsDirectory); }

  run(input: AgentInput): AsyncIterable<AgentEvent> { return this.start(input); }
  continue(sessionId: string, input: AgentInput): AsyncIterable<AgentEvent> { return this.start(input, sessionId); }
  generateImage(taskId: string, source: Buffer | null, prompt: string, signal: AbortSignal, guide?: Buffer): Promise<Buffer> { return this.images.generate(taskId, source, prompt, signal, guide); }
  processImage(taskId: string, source: Buffer, input: LocalImageInput, signal: AbortSignal, progress: (value: number) => void): Promise<LocalImageOutput> { return this.localImages.run(taskId, source, input, signal, progress); }
  cancel(taskId: string): Promise<void> {
    this.preparing.get(taskId)?.();
    const running = this.active.get(taskId);
    if (!running) return this.images.cancel(taskId);
    running.cancel();
    return running.closed;
  }

  private start(input: AgentInput, sessionId?: string): AsyncIterable<AgentEvent> {
    const stream = new Readable({ objectMode: true, read() {} });
    let terminal = false;
    let cancelled = false;
    if (this.preparing.has(input.taskId) || this.active.has(input.taskId)) {
      stream.push({ type: 'failed', message: '该任务已在运行。' } satisfies AgentEvent);
      stream.push(null);
      return stream as AsyncIterable<AgentEvent>;
    }
    this.preparing.set(input.taskId, () => { cancelled = true; });
    const finish = (event: AgentEvent) => { if (terminal) return; terminal = true; stream.push(event); stream.push(null); };
    /* 输入、Schema 和日志只写入独立任务目录；CLI 无 Shell、浏览器、插件或应用工具权限。 */
    Promise.resolve().then(() => {
      if (!/^[a-f\d-]{36}$/i.test(input.taskId) || (sessionId && !/^[a-f\d-]{36}$/i.test(sessionId))) throw new Error('任务或会话编号无效。');
      if (input.images && (!Array.isArray(input.images) || input.images.length > 9 || input.images.some((image) => !Buffer.isBuffer(image) || !image.length || image.length > 20 * 1024 * 1024) || input.images.reduce((total, image) => total + image.length, 0) > 64 * 1024 * 1024)) throw new Error('Agent 图片输入超过限制。');
      if (this.active.has(input.taskId)) throw new Error('该任务已在运行。');
      return inspectCodex();
    }).then((status) => {
      this.preparing.delete(input.taskId);
      if (cancelled || stream.destroyed) { finish({ type: 'cancelled' }); return; }
      if (status.status !== 'ready') throw new Error(status.message);
      const executable = findCodexExecutable();
      if (!executable) throw new Error('未找到 Codex CLI。');
      const directory = resolve(this.runsDirectory, input.taskId);
      mkdirSync(directory, { recursive: true });
      if (realpathSync(directory).toLowerCase() !== directory.toLowerCase()) throw new Error('任务目录不能使用符号链接。');
      const schema = resolve(directory, 'schema.json');
      writeFileSync(schema, JSON.stringify(input.schema), 'utf8');
      writeFileSync(resolve(directory, 'input.txt'), input.prompt, 'utf8');
      const images = (input.images ?? []).map((image, index) => { const path = resolve(directory, `image-${index + 1}.png`); writeFileSync(path, image); return path; });
      const args = ['exec', ...(sessionId ? ['resume', sessionId] : []), '--model', process.env.PHOTO_STUDIO_CODEX_MODEL || 'gpt-5.5', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '--json', '--output-schema', schema];
      for (const setting of ['sandbox_mode="read-only"', 'approval_policy="never"', 'web_search="disabled"', 'project_doc_max_bytes=0', 'features.shell_tool=false', 'features.unified_exec=false', 'features.plugins=false', 'features.apps=false', 'features.browser_use=false', 'features.computer_use=false', 'features.image_generation=false', 'features.in_app_browser=false', 'features.multi_agent=false', 'features.hooks=false', 'features.memories=false']) args.push('-c', setting);
      for (const image of images) args.push('--image', image);
      args.push('-');
      const env = { ...process.env };
      delete env.OPENAI_API_KEY;
      delete env.CODEX_API_KEY;
      const child = spawn(executable, args, { cwd: directory, env, shell: false, windowsHide: true });
      let resolveClosed: () => void = () => {};
      const closed = new Promise<void>((resolvePromise) => { resolveClosed = resolvePromise; });
      let failure = '';
      let buffer = '';
      let answer = '';
      let completed = false;
      let totalBytes = 0;
      let stderrBytes = 0;
      const messages = new Map<string, string>();
      const fail = (message: string) => { if (!failure) failure = message; child.kill(); };
      const cancel = () => { cancelled = true; child.kill(); };
      this.active.set(input.taskId, { child, cancel, closed });
      const timeout = setTimeout(() => fail('Agent 响应超时，请稍后重试。'), 180000);
      stream.once('close', () => { if (!terminal) cancel(); });
      const parseLine = (line: string) => {
        if (!line.trim() || failure || cancelled) return;
        appendFileSync(resolve(directory, 'events.jsonl'), `${line}\n`, 'utf8');
        const event = JSON.parse(line) as Record<string, unknown>;
        if (event.type === 'thread.started') {
          if (typeof event.thread_id !== 'string' || !/^[a-f\d-]{36}$/i.test(event.thread_id)) throw new Error('CLI 会话事件无效。');
          stream.push({ type: 'started', sessionId: event.thread_id } satisfies AgentEvent);
        } else if (event.type === 'turn.completed') completed = true;
        else if (event.type === 'turn.failed' || event.type === 'error') {
          const raw = JSON.stringify(event);
          fail(/quota|usage.limit|rate.limit|429/i.test(raw) ? 'Codex 额度或调用频率受限，请稍后重试。' : /unauthorized|authentication|401|not.logged/i.test(raw) ? 'Codex 登录已失效，请重新登录后重试。' : 'Codex 调用失败，请检查本机连接后重试。');
        } else if (typeof event.type === 'string' && event.type.startsWith('item.')) {
          const item = event.item as Record<string, unknown>;
          if (!item || typeof item.type !== 'string') throw new Error('CLI 内容事件无效。');
          if (item.type === 'agent_message') {
            if (typeof item.text !== 'string' || typeof item.id !== 'string') throw new Error('CLI 消息事件无效。');
            const previous = messages.get(item.id) ?? '';
            if (item.text.startsWith(previous)) stream.push({ type: 'content_delta', text: item.text.slice(previous.length) } satisfies AgentEvent);
            messages.set(item.id, item.text);
            if (event.type === 'item.completed') answer = item.text;
          } else if (!['reasoning', 'plan', 'todo_list'].includes(item.type)) fail('Agent 尝试调用本阶段未开放的工具，任务已停止。');
        }
      };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        totalBytes += Buffer.byteLength(chunk);
        if (totalBytes > 2 * 1024 * 1024) { fail('Agent 输出超过限制，任务已停止。'); return; }
        buffer += chunk;
        try {
          for (let index; (index = buffer.indexOf('\n')) !== -1;) {
            const line = buffer.slice(0, index);
            buffer = buffer.slice(index + 1);
            parseLine(line);
          }
        } catch { fail('无法读取 Codex 事件，请检查 CLI 版本后重试。'); }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length;
        try { if (stderrBytes <= 256 * 1024) appendFileSync(resolve(directory, 'stderr.log'), chunk); }
        catch { fail('无法保存任务日志，请检查本地数据目录。'); }
      });
      child.stdin.on('error', () => fail('无法向 Codex 发送任务。'));
      child.once('error', () => { failure = '无法启动 Codex，请检查本机安装。'; });
      child.once('close', (code) => {
        clearTimeout(timeout);
        this.active.delete(input.taskId);
        try {
          if (buffer.trim()) parseLine(buffer);
          if (cancelled) finish({ type: 'cancelled' });
          else if (failure || code !== 0 || !completed) finish({ type: 'failed', message: failure || 'Codex 未能完成任务，请重试。' });
          else finish({ type: 'completed', result: JSON.parse(answer) as unknown });
        } catch { finish({ type: 'failed', message: 'Codex 返回的结果不是有效 JSON，请重试。' }); }
        resolveClosed();
      });
      child.stdin.end(input.prompt);
    }).catch((error: Error) => { this.preparing.delete(input.taskId); finish(cancelled ? { type: 'cancelled' } : { type: 'failed', message: error.message }); });
    return stream as AsyncIterable<AgentEvent>;
  }
}
