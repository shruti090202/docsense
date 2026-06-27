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

export const CostSummarySchema = z.object({
  emi: z.number(),
  tenureMonths: z.number().int(),
  totalRepayment: z.number(),
  totalInterest: z.number(),
  upfrontFees: z.number(),
  netDisbursal: z.number(),
  totalCostOfCredit: z.number(),
  effectiveAnnualRatePercent: z.number(),
  aprPercent: z.number(),
});
export type CostSummary = z.infer<typeof CostSummarySchema>;

export const CostResponseSchema = z.object({
  cost: CostSummarySchema.nullable(),
  upfrontBreakdown: z.array(z.object({ label: z.string(), amount: z.number() })),
  missing: z.array(z.string()),
});
export type CostResponse = z.infer<typeof CostResponseSchema>;

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
  cost: CostResponseSchema.nullable(),
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

export const CompareRequestSchema = z.object({
  leftId: z.string().uuid(),
  rightId: z.string().uuid(),
});
export type CompareRequest = z.infer<typeof CompareRequestSchema>;

export const CompareDifferenceSchema = z.object({
  aspect: z.string(),
  left: z.string(),
  right: z.string(),
  favours: z.enum(['left', 'right', 'neither']),
  note: z.string(),
});
export type CompareDifference = z.infer<typeof CompareDifferenceSchema>;

export const CompareSideSchema = z.object({
  documentId: z.string().uuid(),
  title: z.string(),
  terms: LoanTermsSchema,
  cost: CostResponseSchema,
  riskFlags: z.array(RiskFlagSchema).nullable(),
});

export const CompareResponseSchema = z.object({
  left: CompareSideSchema,
  right: CompareSideSchema,
  summary: z.string(),
  differences: z.array(CompareDifferenceSchema),
  cheaper: z.enum(['left', 'right', 'unknown']),
});
export type CompareResponse = z.infer<typeof CompareResponseSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
