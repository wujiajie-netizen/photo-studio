import type { EditorTextLayer } from '@photo-studio/shared';

export type ImageObjectRegion = { name: string; x: number; y: number; width: number; height: number };
export type LocalImageInput =
  | { operation: 'recognize-text' | 'prepare-layers' | 'cutout' }
  | { operation: 'split-layers'; objects: ImageObjectRegion[] };
export type LocalImageOutput = {
  images: { data: Buffer; width: number; height: number; name: string }[];
  text: Pick<EditorTextLayer, 'text' | 'x' | 'y' | 'width' | 'height' | 'rotation' | 'fill' | 'align' | 'fontFamily' | 'fontSize' | 'fontStyle' | 'letterSpacing' | 'lineHeight' | 'fillGradient'>[];
};

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
  generateImage(taskId: string, source: Buffer | null, prompt: string, signal: AbortSignal, guide?: Buffer): Promise<Buffer>;
  processImage(taskId: string, source: Buffer, input: LocalImageInput, signal: AbortSignal, progress: (value: number) => void): Promise<LocalImageOutput>;
  cancel(taskId: string): Promise<void>;
}
