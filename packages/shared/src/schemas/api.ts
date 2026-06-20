import { z } from 'zod';
import { CitationSchema, PiiMapSchema, SourceTypeSchema } from './common.js';
import { LoanTermsSchema, RiskFlagSchema } from './loanTerms.js';

export const DocumentStatusSchema = z.enum(['parsed', 'embedded', 'failed']);
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

export const UploadResponseSchema = z.object({
  documentId: z.string().uuid(),
  title: z.string(),
  sourceType: SourceTypeSchema,
  pageCount: z.number().int(),
  chunkCount: z.number().int(),
  status: DocumentStatusSchema,
  piiMap: PiiMapSchema,
  warnings: z.array(z.string()),
});
export type UploadResponse = z.infer<typeof UploadResponseSchema>;

export const SampleInfoSchema = z.object({
  slug: z.string(),
  title: z.string(),
  pageCount: z.number().int(),
  loaded: z.boolean(),
});
export type SampleInfo = z.infer<typeof SampleInfoSchema>;

export const DocumentSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  sourceType: SourceTypeSchema,
  pageCount: z.number().int(),
  chunkCount: z.number().int(),
  status: DocumentStatusSchema,
  isSample: z.boolean(),
  extraction: LoanTermsSchema.nullable(),
  riskFlags: z.array(RiskFlagSchema).nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type DocumentSummary = z.infer<typeof DocumentSummarySchema>;

export const ChatTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(8000),
});
export type ChatTurn = z.infer<typeof ChatTurnSchema>;

export const AskRequestSchema = z.object({
  question: z.string().min(1).max(2000),
  history: z.array(ChatTurnSchema).max(20).default([]),
  // the map returned at upload; lets identifiers typed into a question reuse the same placeholders
  piiMap: PiiMapSchema.optional(),
});
export type AskRequest = z.infer<typeof AskRequestSchema>;

export const ToolCallRecordSchema = z.object({
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
  result: z.unknown(),
});
export type ToolCallRecord = z.infer<typeof ToolCallRecordSchema>;

export const AskResponseSchema = z.object({
  answer: z.string(),
  citations: z.array(CitationSchema),
  toolCalls: z.array(ToolCallRecordSchema),
  grounded: z.boolean(),
  cached: z.boolean(),
});
export type AskResponse = z.infer<typeof AskResponseSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
