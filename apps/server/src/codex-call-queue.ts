import type { AgentEvent, AgentInput, AgentModelProvider, LocalImageInput } from '@photo-studio/ai-provider';

export class CodexCallQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private waiting = 0;

  enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.waiting >= 100) return Promise.reject(new Error('任务队列已满，请稍后重试。'));
    ++this.waiting;
    const work = this.tail.catch(() => {}).then(operation).finally(() => { --this.waiting; });
    this.tail = work.catch(() => {});
    return work;
  }
}

/* 各账号独立业务状态，共用一个进程内执行队列；队列等待期间取消，不会再启动 CLI。 */
export class QueuedModelProvider implements AgentModelProvider {
  private readonly cancelled = new Set<string>();
  private readonly active = new Set<string>();
  constructor(private readonly provider: AgentModelProvider, private readonly queue: CodexCallQueue) {}

  run(input: AgentInput): AsyncIterable<AgentEvent> { return this.stream(input.taskId, () => this.provider.run(input)); }
  continue(sessionId: string, input: AgentInput): AsyncIterable<AgentEvent> { return this.stream(input.taskId, () => this.provider.continue(sessionId, input)); }
  private stream(id: string, start: () => AsyncIterable<AgentEvent>): AsyncIterable<AgentEvent> {
    const events: AgentEvent[] = []; let done = false;
    let wake: (() => void) | undefined;
    const push = (event: AgentEvent) => { events.push(event); wake?.(); wake = undefined; };
    this.active.add(id);
    this.queue.enqueue(() => {
      if (this.cancelled.has(id)) { push({ type: 'cancelled' }); return Promise.resolve(); }
      const iterator = start()[Symbol.asyncIterator]();
      const read = (): Promise<void> => iterator.next().then(value => {
        if (value.done) return;
        push(value.value); return read();
      });
      return read();
    }).catch((error: Error) => push({ type: 'failed', message: error.message }))
      .finally(() => { this.cancelled.delete(id); this.active.delete(id); done = true; wake?.(); });
    const next = (): Promise<IteratorResult<AgentEvent>> => {
      if (events.length) return Promise.resolve({ value: events.shift()!, done: false });
      if (done) return Promise.resolve({ value: undefined, done: true });
      return new Promise<void>(resolveNext => { wake = resolveNext; }).then(next);
    };
    return { [Symbol.asyncIterator]: () => ({ next }) };
  }
  generateImage(id: string, source: Buffer | null, prompt: string, signal: AbortSignal, guide?: Buffer) {
    return this.queue.enqueue(() => {
      if (signal.aborted) throw new Error('图片生成已取消。');
      return this.provider.generateImage(id, source, prompt, signal, guide);
    });
  }
  processImage(id: string, source: Buffer, input: LocalImageInput, signal: AbortSignal, progress: (value: number) => void) {
    return this.queue.enqueue(() => {
      if (signal.aborted) throw new Error('图片处理已取消。');
      return this.provider.processImage(id, source, input, signal, progress);
    });
  }
  cancel(id: string): Promise<void> {
    if (this.active.has(id)) this.cancelled.add(id);
    return this.provider.cancel(id);
  }
}
