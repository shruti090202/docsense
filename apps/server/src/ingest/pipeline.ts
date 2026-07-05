import { createHash } from 'node:crypto';
import type { DocumentKind, PiiMap, PiiType, SourceType } from '@docsense/shared';
import { PiiMasker } from '../privacy/pii.js';
import { chunkDocument, type ChunkOptions } from './chunker.js';
import { classifyDocument } from './classify.js';
import { parseDocx } from './docx.js';
import { parsePdf } from './pdf.js';
import { IngestError, type Chunk, type ParsedDocument } from './types.js';

export interface IngestInput {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}

export interface IngestOptions {
  maxPages: number;
  chunk?: Partial<ChunkOptions>;
}

export interface IngestResult {
  sourceType: SourceType;
  kind: DocumentKind;
  title: string;
  pageCount: number;
  contentHash: string;
  chunks: Chunk[];
  piiMap: PiiMap;
  piiCounts: Record<PiiType, number>;
  warnings: string[];
}

const PDF_TYPES = new Set(['application/pdf']);
const DOCX_TYPES = new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

export function detectSourceType(mimeType: string, fileName: string): SourceType {
  const ext = fileName.toLowerCase().split('.').pop();
  if (PDF_TYPES.has(mimeType) || ext === 'pdf') return 'pdf';
  if (DOCX_TYPES.has(mimeType) || ext === 'docx') return 'docx';
  throw new IngestError('UNSUPPORTED_TYPE', 'Only PDF and DOCX files are supported');
}

export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return base.slice(0, 120) || 'Untitled document';
}

export async function parseUpload(input: IngestInput, opts: IngestOptions): Promise<ParsedDocument> {
  const sourceType = detectSourceType(input.mimeType, input.fileName);
  return sourceType === 'pdf' ? parsePdf(input.buffer, { maxPages: opts.maxPages }) : parseDocx(input.buffer);
}

// Masking happens on the parsed pages, before chunking, so neither the database nor any
// Gemini call ever sees the original identifiers.
export function maskAndChunk(parsed: ParsedDocument, chunkOptions?: Partial<ChunkOptions>) {
  const masker = new PiiMasker();
  const counts: Record<PiiType, number> = { AADHAAR: 0, PAN: 0, IFSC: 0, ACCOUNT: 0, PHONE: 0, EMAIL: 0 };
  const maskedPages = parsed.pages.map((p) => {
    const r = masker.mask(p.text);
    for (const k of Object.keys(counts) as PiiType[]) counts[k] += r.counts[k];
    return { page: p.page, text: r.text };
  });
  const chunks = chunkDocument(maskedPages, chunkOptions);
  const contentHash = createHash('sha256')
    .update(maskedPages.map((p) => p.text).join('\f'))
    .digest('hex');
  return { chunks, piiMap: masker.map, piiCounts: counts, contentHash };
}

export async function ingest(input: IngestInput, opts: IngestOptions): Promise<IngestResult> {
  const parsed = await parseUpload(input, opts);
  const { chunks, piiMap, piiCounts, contentHash } = maskAndChunk(parsed, opts.chunk);
  if (chunks.length === 0) throw new IngestError('EMPTY_DOCUMENT', 'No text could be extracted from this file.');
  const { kind } = classifyDocument(chunks.map((c) => c.content).join('\n'));
  return {
    sourceType: parsed.sourceType,
    kind,
    title: titleFromFileName(input.fileName),
    pageCount: parsed.pageCount,
    contentHash,
    chunks,
    piiMap,
    piiCounts,
    warnings: parsed.warnings,
  };
}
