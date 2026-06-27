import { z } from 'zod';
import { LoanTermsSchema, type Citation, type LoanTerms } from '@docsense/shared';
import type { DocumentRepository, DocumentRow } from '../db/documents.js';
import type { Db } from '../db/pool.js';
import { HttpError, notFound } from '../http/errors.js';
import type { LlmClient, Message } from '../llm/types.js';
import type { Logger } from '../logger.js';
import { quoteFrom } from '../qa/citations.js';
import { formatContext } from '../qa/prompt.js';
import type { HybridSearch, RetrievedChunk } from '../retrieval/search.js';
import { EXTRACTION_QUERIES, EXTRACTION_SYSTEM_PROMPT, ExtractionOutputSchema, extractionJsonSchema, type ExtractionOutput } from './schema.js';

export interface ExtractionDeps {
  db: Db;
  llm: LlmClient;
  documents: DocumentRepository;
  search: HybridSearch;
  logger: Logger;
  extractionModel: string;
}

const MAX_CONTEXT_CHUNKS = 40;

// Fallback used when the whole object fails validation twice: every top-level field is parsed on its
// own so one malformed fee does not throw away the eleven good ones.
export function salvage(raw: unknown): ExtractionOutput {
  const shape = ExtractionOutputSchema.shape;
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const notFoundField = { value: null, ref: null, confidence: 0 };
  const notFoundFee = { amount: null, percent: null, description: null, ref: null, confidence: 0 };
  const fallback: ExtractionOutput = {
    lenderName: notFoundField,
    principalAmount: notFoundField,
    interestRate: { annualPercent: null, rateType: 'unknown', method: 'unknown', benchmark: null, ref: null, confidence: 0 },
    tenureMonths: notFoundField,
    statedEmi: notFoundField,
    processingFee: notFoundFee,
    insurancePremium: notFoundFee,
    otherUpfrontCharges: [],
    prepaymentCharges: notFoundFee,
    latePaymentCharges: notFoundFee,
    bounceCharges: notFoundFee,
  };
  const out: Record<string, unknown> = { ...fallback };
  for (const key of Object.keys(shape) as (keyof typeof shape)[]) {
    const parsed = shape[key].safeParse(obj[key]);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as ExtractionOutput;
}

export function toLoanTerms(output: ExtractionOutput, chunks: RetrievedChunk[]): LoanTerms {
  const cite = (ref: number | null): Citation | null => {
    if (ref === null || ref < 1 || ref > chunks.length) return null;
    const c = chunks[ref - 1]!;
    return { chunkId: c.id, page: c.page_start, pageEnd: c.page_end, clauseTitle: c.clause_title, quote: quoteFrom(c.content) };
  };
  const evidence = (ref: number | null, confidence: number, present: boolean) => {
    const citation = present ? cite(ref) : null;
    return { citation, confidence: present ? confidence : 0, notFound: !present };
  };
  const fee = (f: ExtractionOutput['processingFee']) => {
    const present = f.amount !== null || f.percent !== null;
    return { amount: f.amount, percent: f.percent, description: f.description, ...evidence(f.ref, f.confidence, present) };
  };
  const ir = output.interestRate;
  return LoanTermsSchema.parse({
    lenderName: { value: output.lenderName.value, ...evidence(output.lenderName.ref, output.lenderName.confidence, output.lenderName.value !== null) },
    principal: { amount: output.principalAmount.value, currency: 'INR', ...evidence(output.principalAmount.ref, output.principalAmount.confidence, output.principalAmount.value !== null) },
    interestRate: { annualPercent: ir.annualPercent, rateType: ir.rateType, method: ir.method, benchmark: ir.benchmark, ...evidence(ir.ref, ir.confidence, ir.annualPercent !== null) },
    tenureMonths: { value: output.tenureMonths.value, ...evidence(output.tenureMonths.ref, output.tenureMonths.confidence, output.tenureMonths.value !== null) },
    statedEmi: { amount: output.statedEmi.value, ...evidence(output.statedEmi.ref, output.statedEmi.confidence, output.statedEmi.value !== null) },
    processingFee: fee(output.processingFee),
    insurancePremium: fee(output.insurancePremium),
    otherUpfrontCharges: output.otherUpfrontCharges.map(fee),
    prepaymentCharges: fee(output.prepaymentCharges),
    latePaymentCharges: fee(output.latePaymentCharges),
    bounceCharges: fee(output.bounceCharges),
  });
}

export class ExtractionService {
  constructor(private readonly deps: ExtractionDeps) {}

  async contextFor(documentId: string): Promise<RetrievedChunk[]> {
    const seen = new Map<string, RetrievedChunk>();
    for (const q of EXTRACTION_QUERIES) {
      const hits = await this.deps.search.search(documentId, q, { topK: 6, vectorWeight: 1, textWeight: 1 });
      for (const h of hits) if (!seen.has(h.id)) seen.set(h.id, h);
    }
    return [...seen.values()].sort((a, b) => a.chunk_index - b.chunk_index).slice(0, MAX_CONTEXT_CHUNKS);
  }

  private async callModel(messages: Message[]): Promise<{ raw: unknown; text: string }> {
    const res = await this.deps.llm.generate({
      system: EXTRACTION_SYSTEM_PROMPT,
      messages,
      responseSchema: extractionJsonSchema(),
      temperature: 0,
      maxOutputTokens: 4096,
      model: this.deps.extractionModel,
    });
    if (!res.text) throw new HttpError(502, 'LLM_EMPTY', 'The model returned no extraction');
    try {
      return { raw: JSON.parse(res.text), text: res.text };
    } catch {
      return { raw: null, text: res.text };
    }
  }

  async extract(doc: DocumentRow, opts: { force?: boolean } = {}): Promise<LoanTerms> {
    if (doc.extraction && !opts.force) return doc.extraction;
    const { logger, db } = this.deps;
    const started = Date.now();
    const chunks = await this.contextFor(doc.id);
    if (chunks.length === 0) throw notFound('Document has no indexed content');
    const messages: Message[] = [{ role: 'user', parts: [{ text: `Passages:\n\n${formatContext(chunks)}\n\nExtract the loan terms as JSON.` }] }];

    let attempt = await this.callModel(messages);
    let parsed = ExtractionOutputSchema.safeParse(attempt.raw);
    let retried = false;
    if (!parsed.success) {
      retried = true;
      const issues = parsed.error.issues.slice(0, 8).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      logger.warn({ documentId: doc.id, issues }, 'extraction failed validation, retrying');
      attempt = await this.callModel([
        ...messages,
        { role: 'model', parts: [{ text: attempt.text }] },
        { role: 'user', parts: [{ text: `That JSON failed validation: ${issues}. Return the corrected JSON only.` }] },
      ]);
      parsed = ExtractionOutputSchema.safeParse(attempt.raw);
    }
    const output = parsed.success ? parsed.data : salvage(attempt.raw);
    const salvaged = !parsed.success;
    const terms = toLoanTerms(output, chunks);
    await db.query('UPDATE documents SET extraction = $2 WHERE id = $1', [doc.id, JSON.stringify(terms)]);
    const found = Object.entries(terms).filter(([k, v]) => k !== 'otherUpfrontCharges' && !(v as { notFound: boolean }).notFound).length;
    logger.info({ documentId: doc.id, ms: Date.now() - started, contextChunks: chunks.length, retried, salvaged, fieldsFound: found }, 'terms extracted');
    return terms;
  }
}

export const ForceQuery = z.object({ force: z.enum(['1', 'true']).optional() });
