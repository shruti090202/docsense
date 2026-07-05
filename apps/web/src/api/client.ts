import { z } from 'zod';
import {
  AnalysisResponseSchema,
  AskResponseSchema,
  CompareResponseSchema,
  DocumentSummarySchema,
  RiskFlagSchema,
  SampleInfoSchema,
  UploadResponseSchema,
  type AskRequest,
  type AskResponse,
  type CompareResponse,
  type DocumentSummary,
  type SampleInfo,
  type UploadResponse,
} from '@docsense/shared';

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:8080';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get friendly(): string {
    switch (this.code) {
      case 'LLM_RATE_LIMITED':
        return `The free AI quota is busy right now. Try again in ${this.retryAfterSec ?? 30} seconds.`;
      case 'RATE_LIMITED':
        return 'Too many requests from this network. Give it a minute.';
      case 'SCANNED_PDF':
      case 'UNSUPPORTED_TYPE':
      case 'PAYLOAD_TOO_LARGE':
      case 'TOO_MANY_PAGES':
      case 'EMPTY_DOCUMENT':
        return this.message;
      case 'NOT_FOUND':
        return 'That document has expired on the server (documents are deleted after 24 hours). Upload it again.';
      case 'LLM_NOT_CONFIGURED':
        return 'The server has no AI key configured.';
      default:
        return this.status === 0 ? 'Cannot reach the server. It may be waking up from sleep; try again in a minute.' : this.message;
    }
  }
}

const ErrorBody = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

async function call<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network error');
  }
  if (!res.ok) {
    const retryAfter = Number(res.headers.get('retry-after') ?? '') || undefined;
    const body = ErrorBody.safeParse(await res.json().catch(() => null));
    const code = body.success ? body.data.error.code : `HTTP_${res.status}`;
    const message = body.success ? body.data.error.message : res.statusText;
    throw new ApiError(res.status, code, message, retryAfter);
  }
  if (res.status === 204) return undefined as T;
  return schema.parse(await res.json());
}

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  health: () => call('/health', {}, z.object({ status: z.string(), version: z.string() })),

  upload(file: File): Promise<UploadResponse> {
    const form = new FormData();
    form.append('file', file, file.name);
    return call('/api/documents', { method: 'POST', body: form }, UploadResponseSchema);
  },

  document: (id: string): Promise<DocumentSummary> => call(`/api/documents/${id}`, {}, DocumentSummarySchema),

  chunk: (documentId: string, chunkId: string) =>
    call(
      `/api/documents/${documentId}/chunks/${chunkId}`,
      {},
      z.object({ id: z.string(), index: z.number(), pageStart: z.number(), pageEnd: z.number(), clauseTitle: z.string().nullable(), content: z.string() }),
    ),

  ask: (documentId: string, body: AskRequest): Promise<AskResponse> => call(`/api/documents/${documentId}/ask`, json(body), AskResponseSchema),

  extract: (documentId: string) => call(`/api/documents/${documentId}/extract`, { method: 'POST' }, AnalysisResponseSchema),

  risks: (documentId: string) => call(`/api/documents/${documentId}/risks`, { method: 'POST' }, z.object({ riskFlags: z.array(RiskFlagSchema) })),

  compare: (leftId: string, rightId: string): Promise<CompareResponse> => call('/api/compare', json({ leftId, rightId }), CompareResponseSchema),

  samples: (): Promise<SampleInfo[]> => call('/api/samples', {}, z.array(SampleInfoSchema)),

  loadSample: (slug: string): Promise<UploadResponse> => call(`/api/samples/${slug}/load`, { method: 'POST' }, UploadResponseSchema),

  remove: (id: string) => call(`/api/documents/${id}`, { method: 'DELETE' }, z.undefined()),
};
