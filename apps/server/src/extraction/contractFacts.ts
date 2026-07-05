import { z } from 'zod';
import { ContractFactsSchema, type Citation, type ContractFacts } from '@docsense/shared';
import type { DocumentRow } from '../db/documents.js';
import type { Db } from '../db/pool.js';
import { HttpError, notFound } from '../http/errors.js';
import type { LlmClient, Message } from '../llm/types.js';
import type { Logger } from '../logger.js';
import { quoteFrom } from '../qa/citations.js';
import { formatContext } from '../qa/prompt.js';
import type { HybridSearch, RetrievedChunk } from '../retrieval/search.js';

const ref = z.number().int().nullable();
const confidence = z.number().min(0).max(1);
const fact = z.object({ value: z.string().nullable(), ref, confidence });

export const ContractOutputSchema = z.object({
  documentType: fact.describe('what kind of agreement this is, e.g. "Leave and licence agreement", "Employment contract"'),
  parties: z.object({ value: z.array(z.string()).describe('names or roles of the parties, e.g. ["Sunita Deshpande (Licensor)", "Kabir Malhotra (Licensee)"]'), ref, confidence }),
  effectiveDate: fact.describe('start or signing date as written'),
  term: fact.describe('duration or end date, e.g. "24 months from 1 August 2026"'),
  paymentObligations: fact.describe('what is paid, how much, how often, by whom'),
  securityDeposit: fact.describe('deposit or advance amount and refund terms; null if none'),
  noticePeriod: fact.describe('notice required to terminate or not renew'),
  terminationConditions: fact.describe('who can terminate and on what grounds'),
  renewal: fact.describe('renewal or extension terms, including automatic renewal'),
  governingLaw: fact.describe('governing law, jurisdiction, arbitration'),
});
export type ContractOutput = z.infer<typeof ContractOutputSchema>;

function jsonSchema(): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(ContractOutputSchema, { target: 'draft-7' }) as Record<string, unknown>;
  return rest;
}

const SYSTEM_PROMPT = `You extract the key facts of an agreement from numbered passages into JSON.

Rules:
1. Use only the passages. A fact that is not stated must be null with ref null and confidence 0. Never infer.
2. Keep values short and literal: quote amounts, dates and periods as the document writes them.
3. Set ref to the passage number the fact was read from; prefer the operative clause over a summary schedule.
4. Tokens like [PAN_1] or [PHONE_1] are redacted identifiers; do not include them in any value.
5. confidence: 1.0 verbatim, 0.7 clearly implied, 0.4 uncertain.`;

export const CONTRACT_QUERIES = [
  'agreement made between parties name of the parties hereinafter',
  'term of the agreement commence period months years expiry',
  'payment fee rent consideration payable monthly amount due date',
  'security deposit advance refundable forfeited',
  'termination notice period terminate written notice',
  'renewal extension automatically renew',
  'governing law jurisdiction arbitration dispute',
  'schedule summary of terms',
];

const NOT_FOUND = { value: null, ref: null, confidence: 0 };

export function salvageContract(raw: unknown): ContractOutput {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {
    documentType: NOT_FOUND,
    parties: { value: [], ref: null, confidence: 0 },
    effectiveDate: NOT_FOUND,
    term: NOT_FOUND,
    paymentObligations: NOT_FOUND,
    securityDeposit: NOT_FOUND,
    noticePeriod: NOT_FOUND,
    terminationConditions: NOT_FOUND,
    renewal: NOT_FOUND,
    governingLaw: NOT_FOUND,
  };
  const shape = ContractOutputSchema.shape;
  for (const key of Object.keys(shape) as (keyof typeof shape)[]) {
    const parsed = shape[key].safeParse(obj[key]);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as ContractOutput;
}

export function toContractFacts(output: ContractOutput, chunks: RetrievedChunk[]): ContractFacts {
  const cite = (r: number | null): Citation | null => {
    if (r === null || r < 1 || r > chunks.length) return null;
    const c = chunks[r - 1]!;
    return { chunkId: c.id, page: c.page_start, pageEnd: c.page_end, clauseTitle: c.clause_title, quote: quoteFrom(c.content) };
  };
  const f = (x: { value: string | null; ref: number | null; confidence: number }) => ({
    value: x.value,
    citation: x.value !== null ? cite(x.ref) : null,
    confidence: x.value !== null ? x.confidence : 0,
    notFound: x.value === null,
  });
  return ContractFactsSchema.parse({
    documentType: f(output.documentType),
    parties: {
      value: output.parties.value,
      citation: output.parties.value.length ? cite(output.parties.ref) : null,
      confidence: output.parties.value.length ? output.parties.confidence : 0,
      notFound: output.parties.value.length === 0,
    },
    effectiveDate: f(output.effectiveDate),
    term: f(output.term),
    paymentObligations: f(output.paymentObligations),
    securityDeposit: f(output.securityDeposit),
    noticePeriod: f(output.noticePeriod),
    terminationConditions: f(output.terminationConditions),
    renewal: f(output.renewal),
    governingLaw: f(output.governingLaw),
  });
}

export class ContractFactsService {
  constructor(private readonly deps: { db: Db; llm: LlmClient; search: HybridSearch; logger: Logger; model: string }) {}

  private async call(messages: Message[]): Promise<{ raw: unknown; text: string }> {
    const res = await this.deps.llm.generate({ system: SYSTEM_PROMPT, messages, responseSchema: jsonSchema(), temperature: 0, maxOutputTokens: 2048, model: this.deps.model });
    if (!res.text) throw new HttpError(502, 'LLM_EMPTY', 'The model returned no facts');
    try {
      return { raw: JSON.parse(res.text), text: res.text };
    } catch {
      return { raw: null, text: res.text };
    }
  }

  async extract(doc: DocumentRow, opts: { force?: boolean } = {}): Promise<ContractFacts> {
    if (doc.contract_facts && !opts.force) return doc.contract_facts;
    const started = Date.now();
    const seen = new Map<string, RetrievedChunk>();
    for (const q of CONTRACT_QUERIES) {
      for (const h of await this.deps.search.search(doc.id, q, { topK: 5, vectorWeight: 1, textWeight: 1 })) if (!seen.has(h.id)) seen.set(h.id, h);
    }
    const chunks = [...seen.values()].sort((a, b) => a.chunk_index - b.chunk_index).slice(0, 40);
    if (chunks.length === 0) throw notFound('Document has no indexed content');
    const messages: Message[] = [{ role: 'user', parts: [{ text: `Passages:\n\n${formatContext(chunks)}\n\nExtract the key facts as JSON.` }] }];
    let attempt = await this.call(messages);
    let parsed = ContractOutputSchema.safeParse(attempt.raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, 8).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      attempt = await this.call([...messages, { role: 'model', parts: [{ text: attempt.text }] }, { role: 'user', parts: [{ text: `That JSON failed validation: ${issues}. Return the corrected JSON only.` }] }]);
      parsed = ContractOutputSchema.safeParse(attempt.raw);
    }
    const facts = toContractFacts(parsed.success ? parsed.data : salvageContract(attempt.raw), chunks);
    await this.deps.db.query('UPDATE documents SET contract_facts = $2 WHERE id = $1', [doc.id, JSON.stringify(facts)]);
    this.deps.logger.info({ documentId: doc.id, ms: Date.now() - started, contextChunks: chunks.length, salvaged: !parsed.success }, 'contract facts extracted');
    return facts;
  }
}
