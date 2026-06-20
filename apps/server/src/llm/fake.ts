import { createHash } from 'node:crypto';
import type { EmbeddingTaskType, GenerateRequest, GenerateResponse, LlmClient } from './types.js';

export type GenerateHandler = (req: GenerateRequest, callIndex: number) => GenerateResponse | Promise<GenerateResponse>;

export function textResponse(text: string, model = 'fake-chat'): GenerateResponse {
  return { text, functionCalls: [], parts: [{ text }], usage: { inputTokens: 0, outputTokens: 0 }, model };
}

export function jsonResponse(value: unknown, model = 'fake-chat'): GenerateResponse {
  return textResponse(JSON.stringify(value), model);
}

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'or', 'in', 'on', 'is', 'are', 'be', 'for', 'by', 'with', 'as', 'at', 'it', 'this', 'that', 'shall']);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\[[a-z]+_\d+\]/g, ' ')
    .split(/[^a-z0-9%]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map((t) => t.replace(/(ing|ed|es|s)$/, ''));
}

// Deterministic bag-of-words embedding via feature hashing: lexical overlap => cosine similarity.
// Good enough to make retrieval tests meaningful without any network call.
export function hashEmbedding(text: string, dims: number): number[] {
  const v = new Array<number>(dims).fill(0);
  for (const tok of tokens(text)) {
    const h = createHash('sha1').update(tok).digest();
    const idx = h.readUInt32BE(0) % dims;
    const sign = h[4]! % 2 === 0 ? 1 : -1;
    v[idx] = v[idx]! + sign;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export class FakeLlmClient implements LlmClient {
  readonly chatModel = 'fake-chat';
  readonly embeddingModel = 'fake-embed';
  readonly embeddingDimensions: number;
  readonly generateCalls: GenerateRequest[] = [];
  readonly embedCalls: { texts: string[]; taskType: EmbeddingTaskType }[] = [];
  private handler: GenerateHandler;

  constructor(opts: { dimensions?: number; onGenerate?: GenerateHandler } = {}) {
    this.embeddingDimensions = opts.dimensions ?? 768;
    this.handler = opts.onGenerate ?? (() => textResponse('fake answer'));
  }

  setHandler(handler: GenerateHandler) {
    this.handler = handler;
  }

  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    this.generateCalls.push(req);
    return this.handler(req, this.generateCalls.length - 1);
  }

  async embed(texts: string[], taskType: EmbeddingTaskType): Promise<number[][]> {
    this.embedCalls.push({ texts, taskType });
    return texts.map((t) => hashEmbedding(t, this.embeddingDimensions));
  }
}
