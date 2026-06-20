import { z } from 'zod';

export const CitationSchema = z.object({
  // marker number used in the answer text, e.g. [2]; absent for extraction/risk citations
  ref: z.number().int().positive().optional(),
  chunkId: z.string(),
  page: z.number().int().positive(),
  clauseTitle: z.string().nullable(),
  quote: z.string(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const PiiTypeSchema = z.enum(['AADHAAR', 'PAN', 'IFSC', 'ACCOUNT', 'PHONE', 'EMAIL']);
export type PiiType = z.infer<typeof PiiTypeSchema>;

// placeholder -> original value; lives in the browser after upload, never in the database
export const PiiMapSchema = z.record(z.string(), z.string());
export type PiiMap = z.infer<typeof PiiMapSchema>;

export const SourceTypeSchema = z.enum(['pdf', 'docx']);
export type SourceType = z.infer<typeof SourceTypeSchema>;
