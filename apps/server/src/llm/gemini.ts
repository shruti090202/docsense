import { ApiError, GoogleGenAI, type Content, type Part as GeminiPart } from '@google/genai';
import type { Logger } from '../logger.js';
import { RateLimiter, withRetry } from './throttle.js';
import {
  LlmError,
  type EmbeddingTaskType,
  type GenerateRequest,
  type GenerateResponse,
  type LlmClient,
  type Message,
  type Part,
} from './types.js';

export interface GeminiClientOptions {
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
  embeddingDimensions: number;
  chatRpm: number;
  embedRpm: number;
  logger: Logger;
}

// Gemini's retry hint arrives inside the error message as "retryDelay":"12s"
function retryDelayFrom(err: unknown): number | undefined {
  const m = /retryDelay"?:\s*"?(\d+(?:\.\d+)?)s/.exec((err as Error).message ?? '');
  return m ? Math.ceil(Number(m[1]) * 1000) : undefined;
}

function classify(err: unknown): { retry: boolean; retryAfterMs?: number } {
  const status = err instanceof ApiError ? err.status : (err as { status?: number }).status;
  if (status === 429) {
    const retryAfterMs = retryDelayFrom(err);
    return retryAfterMs === undefined ? { retry: true } : { retry: true, retryAfterMs };
  }
  if (status === 500 || status === 502 || status === 503 || status === 504) return { retry: true };
  if ((err as { code?: string }).code === 'ECONNRESET' || (err as { name?: string }).name === 'FetchError') return { retry: true };
  return { retry: false };
}

function toLlmError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  const status = err instanceof ApiError ? err.status : (err as { status?: number }).status;
  const message = (err as Error).message ?? String(err);
  if (status === 429) return new LlmError('RATE_LIMITED', 'Gemini free-tier quota exceeded; try again shortly', retryDelayFrom(err));
  if (status && status >= 500) return new LlmError('UNAVAILABLE', `Gemini unavailable (${status})`);
  return new LlmError('UPSTREAM', `Gemini request failed: ${message}`);
}

function toContents(messages: Message[]): Content[] {
  return messages.map((m) => ({ role: m.role, parts: m.parts as GeminiPart[] }));
}

function fromParts(parts: GeminiPart[] | undefined): Part[] {
  const out: Part[] = [];
  for (const p of parts ?? []) {
    if (p.thought) continue;
    if (p.functionCall?.name) {
      out.push({
        functionCall: { name: p.functionCall.name, args: (p.functionCall.args ?? {}) as Record<string, unknown>, ...(p.functionCall.id ? { id: p.functionCall.id } : {}) },
        ...(p.thoughtSignature ? { thoughtSignature: p.thoughtSignature } : {}),
      });
    } else if (typeof p.text === 'string') {
      out.push({ text: p.text, ...(p.thoughtSignature ? { thoughtSignature: p.thoughtSignature } : {}) });
    }
  }
  return out;
}

export class GeminiClient implements LlmClient {
  readonly chatModel: string;
  readonly embeddingModel: string;
  readonly embeddingDimensions: number;
  private readonly ai: GoogleGenAI;
  private readonly chatLimiter: RateLimiter;
  private readonly embedLimiter: RateLimiter;
  private readonly logger: Logger;

  constructor(opts: GeminiClientOptions) {
    this.ai = new GoogleGenAI({ apiKey: opts.apiKey });
    this.chatModel = opts.chatModel;
    this.embeddingModel = opts.embeddingModel;
    this.embeddingDimensions = opts.embeddingDimensions;
    this.chatLimiter = new RateLimiter(opts.chatRpm);
    this.embedLimiter = new RateLimiter(opts.embedRpm);
    this.logger = opts.logger;
  }

  private retrying<T>(label: string, fn: () => Promise<T>): Promise<T> {
    return withRetry(fn, classify, {
      attempts: 4,
      baseDelayMs: 2000,
      maxDelayMs: 20_000,
      onRetry: (attempt, delayMs, err) => this.logger.warn({ label, attempt, delayMs, err: (err as Error).message }, 'gemini retry'),
    }).catch((err) => {
      throw toLlmError(err);
    });
  }

  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    const model = req.model ?? this.chatModel;
    await this.chatLimiter.acquire();
    const started = Date.now();
    const res = await this.retrying('generate', () =>
      this.ai.models.generateContent({
        model,
        contents: toContents(req.messages),
        config: {
          systemInstruction: req.system,
          temperature: req.temperature ?? 0.1,
          maxOutputTokens: req.maxOutputTokens ?? 2048,
          ...(req.tools?.length
            ? { tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }] }
            : {}),
          ...(req.responseSchema ? { responseMimeType: 'application/json', responseJsonSchema: req.responseSchema } : {}),
        },
      }),
    );
    const parts = fromParts(res.candidates?.[0]?.content?.parts);
    const text = parts.filter((p): p is { text: string } => 'text' in p).map((p) => p.text).join('') || null;
    const functionCalls = parts.filter((p): p is Extract<Part, { functionCall: unknown }> => 'functionCall' in p).map((p) => p.functionCall);
    const usage = {
      inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: (res.usageMetadata?.candidatesTokenCount ?? 0) + (res.usageMetadata?.thoughtsTokenCount ?? 0),
    };
    this.logger.info({ model, ms: Date.now() - started, usage, functionCalls: functionCalls.length, finish: res.candidates?.[0]?.finishReason }, 'gemini generate');
    if (text === null && functionCalls.length === 0) {
      throw new LlmError('BAD_RESPONSE', `Gemini returned no content (finishReason=${res.candidates?.[0]?.finishReason ?? 'unknown'})`);
    }
    return { text, functionCalls, parts, usage, model };
  }

  async embed(texts: string[], taskType: EmbeddingTaskType): Promise<number[][]> {
    if (texts.length === 0) return [];
    await this.embedLimiter.acquire();
    const started = Date.now();
    const res = await this.retrying('embed', () =>
      this.ai.models.embedContent({
        model: this.embeddingModel,
        contents: texts,
        config: { taskType, outputDimensionality: this.embeddingDimensions },
      }),
    );
    const vectors = (res.embeddings ?? []).map((e) => e.values ?? []);
    if (vectors.length !== texts.length || vectors.some((v) => v.length !== this.embeddingDimensions)) {
      throw new LlmError('BAD_RESPONSE', `Expected ${texts.length} embeddings of ${this.embeddingDimensions} dims`);
    }
    this.logger.info({ model: this.embeddingModel, count: texts.length, ms: Date.now() - started }, 'gemini embed');
    return vectors.map(normalise);
  }
}

// Truncated Matryoshka embeddings are not unit length; normalise so cosine distance behaves.
export function normalise(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}
