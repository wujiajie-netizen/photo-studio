export interface AgentInput {
  taskId: string;
  prompt: string;
  schema: Record<string, unknown>;
  images?: Buffer[];
}

export type AgentEvent =
  | { type: 'started'; sessionId: string }
  | { type: 'content_delta'; text: string }
  | { type: 'tool_call'; name: string; arguments: unknown }
  | { type: 'completed'; result: unknown }
  | { type: 'failed'; message: string }
  | { type: 'cancelled' };

export interface AgentModelProvider {
  run(input: AgentInput): AsyncIterable<AgentEvent>;
  continue(sessionId: string, input: AgentInput): AsyncIterable<AgentEvent>;
  generateImage(taskId: string, source: Buffer | null, prompt: string, signal: AbortSignal): Promise<Buffer>;
  cancel(taskId: string): Promise<void>;
}
