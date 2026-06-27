import { z } from 'zod';
import { RiskCategorySchema, RiskFlagSchema, type RiskCategory, type RiskFlag } from '@docsense/shared';
import type { ChunkRow, DocumentRepository, DocumentRow } from '../db/documents.js';
import type { Db } from '../db/pool.js';
import { HttpError } from '../http/errors.js';
import type { LlmClient } from '../llm/types.js';
import type { Logger } from '../logger.js';
import { quoteFrom } from '../qa/citations.js';
import { RISK_PATTERNS } from './patterns.js';

export interface RiskCandidate {
  category: RiskCategory;
  chunk: ChunkRow;
  matches: number;
}

const MAX_CANDIDATES_PER_CATEGORY = 2;

// Regex pre-filter over every chunk: cheap, deterministic, and it bounds the size of the single model call.
export function findCandidates(chunks: ChunkRow[]): RiskCandidate[] {
  const out: RiskCandidate[] = [];
  for (const rule of RISK_PATTERNS) {
    const scored = chunks
      .map((chunk) => ({ category: rule.category, chunk, matches: rule.patterns.filter((p) => p.test(chunk.content)).length }))
      .filter((c) => c.matches > 0)
      .sort((a, b) => b.matches - a.matches || a.chunk.chunk_index - b.chunk.chunk_index)
      .slice(0, MAX_CANDIDATES_PER_CATEGORY);
    out.push(...scored);
  }
  return out;
}

const ReviewOutputSchema = z.object({
  reviews: z.array(
    z.object({
      candidate: z.number().int().describe('candidate number being reviewed'),
      present: z.boolean().describe('true only if the passage actually contains the risk described'),
      severity: z.enum(['low', 'medium', 'high']),
      title: z.string().describe('short plain-English label, max 8 words'),
      explanation: z.string().describe('2-3 sentences: what the clause does and why it matters to the borrower'),
    }),
  ),
});

function reviewJsonSchema(): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(ReviewOutputSchema, { target: 'draft-7' }) as Record<string, unknown>;
  return rest;
}

const RISK_SYSTEM_PROMPT = `You review clauses from a loan agreement for a borrower. For each numbered candidate you are told which risk to check and given the passage. Decide from the passage text only.

Rules:
1. present = true only when the passage itself contains the risk described. A clause that protects the borrower (e.g. requires 30 days' notice, allows free cancellation, limits sharing to regulators) is NOT the risk: mark present = false.
2. severity: high when the clause can materially increase cost or remove the borrower's control (compounding penalties, discretionary rate changes, unrestricted data sharing, repossession without notice); medium for standard but one-sided terms; low for common protective terms with minor downside.
3. explanation must be plain English for a non-lawyer, 2-3 sentences, no legal citations, no advice.
4. Tokens like [PAN_1] are redacted identifiers; ignore them.
Review every candidate exactly once.`;

export class RiskService {
  constructor(
    private readonly deps: { db: Db; llm: LlmClient; documents: DocumentRepository; logger: Logger },
  ) {}

  async detect(doc: DocumentRow, opts: { force?: boolean } = {}): Promise<RiskFlag[]> {
    if (doc.risk_flags && !opts.force) return doc.risk_flags;
    const { db, llm, documents, logger } = this.deps;
    const started = Date.now();
    const chunks = await documents.listChunks(doc.id);
    const candidates = findCandidates(chunks);
    let flags: RiskFlag[] = [];
    if (candidates.length > 0) {
      const byCategory = new Map(RISK_PATTERNS.map((r) => [r.category, r]));
      const prompt = candidates
        .map((c, i) => {
          const rule = byCategory.get(c.category)!;
          const page = c.chunk.page_start === c.chunk.page_end ? `page ${c.chunk.page_start}` : `pages ${c.chunk.page_start}-${c.chunk.page_end}`;
          return `Candidate ${i + 1} | risk: ${rule.label} | check: ${rule.question}\n(${page}${c.chunk.clause_title ? ` | clause: ${c.chunk.clause_title}` : ''})\n${c.chunk.content}`;
        })
        .join('\n\n');
      const res = await llm.generate({
        system: RISK_SYSTEM_PROMPT,
        messages: [{ role: 'user', parts: [{ text: `${prompt}\n\nReview all ${candidates.length} candidates.` }] }],
        responseSchema: reviewJsonSchema(),
        temperature: 0,
        maxOutputTokens: 4096,
      });
      if (!res.text) throw new HttpError(502, 'LLM_EMPTY', 'The model returned no risk review');
      let raw: unknown;
      try {
        raw = JSON.parse(res.text);
      } catch {
        throw new HttpError(502, 'LLM_BAD_RESPONSE', 'Risk review was not valid JSON');
      }
      const parsed = ReviewOutputSchema.safeParse(raw);
      if (!parsed.success) throw new HttpError(502, 'LLM_BAD_RESPONSE', 'Risk review did not match the expected shape', parsed.error.issues.slice(0, 5));
      const seen = new Set<RiskCategory>();
      for (const review of parsed.data.reviews) {
        const candidate = candidates[review.candidate - 1];
        if (!candidate || !review.present || seen.has(candidate.category)) continue;
        seen.add(candidate.category);
        const c = candidate.chunk;
        flags.push(
          RiskFlagSchema.parse({
            category: candidate.category,
            severity: review.severity,
            title: review.title,
            explanation: review.explanation,
            citation: { chunkId: c.id, page: c.page_start, pageEnd: c.page_end, clauseTitle: c.clause_title, quote: quoteFrom(c.content) },
          }),
        );
      }
      const order = RiskCategorySchema.options;
      const rank = { high: 0, medium: 1, low: 2 };
      flags = flags.sort((a, b) => rank[a.severity] - rank[b.severity] || order.indexOf(a.category) - order.indexOf(b.category));
    }
    await db.query('UPDATE documents SET risk_flags = $2 WHERE id = $1', [doc.id, JSON.stringify(flags)]);
    logger.info({ documentId: doc.id, ms: Date.now() - started, candidates: candidates.length, flags: flags.length }, 'risks detected');
    return flags;
  }
}
