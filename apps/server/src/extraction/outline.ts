import { z } from 'zod';
import { OutlineSchema, type Outline } from '@docsense/shared';
import type { DocumentRepository, DocumentRow } from '../db/documents.js';
import type { Db } from '../db/pool.js';
import { HttpError, notFound } from '../http/errors.js';
import type { LlmClient } from '../llm/types.js';
import type { Logger } from '../logger.js';
import { quoteFrom } from '../qa/citations.js';

const OutlineOutputSchema = z.object({
  title: z.string().describe('a short title for the document'),
  summary: z.string().describe('3-5 plain sentences on what the document is and covers'),
  sections: z.array(
    z.object({
      heading: z.string().describe('section heading as written, or a short label if the passage has none'),
      gist: z.string().describe('one sentence on what the section says'),
      ref: z.number().int().nullable().describe('passage number the section starts in'),
    }),
  ).max(20),
});

function jsonSchema(): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(OutlineOutputSchema, { target: 'draft-7' }) as Record<string, unknown>;
  return rest;
}

const SYSTEM_PROMPT = `You outline a document from its numbered passages. Use only the passages. Keep the summary factual and short. One outline entry per real section of the document, in document order; do not invent sections. Tokens like [PAN_1] are redacted identifiers; ignore them.`;

// Up to 40 chunks in document order: enough for a lecture, a report or a short manual.
const MAX_CHUNKS = 40;

export class OutlineService {
  constructor(private readonly deps: { db: Db; llm: LlmClient; documents: DocumentRepository; logger: Logger; model: string }) {}

  async build(doc: DocumentRow, opts: { force?: boolean } = {}): Promise<Outline> {
    if (doc.outline && !opts.force) return doc.outline;
    const started = Date.now();
    const chunks = (await this.deps.documents.listChunks(doc.id)).slice(0, MAX_CHUNKS);
    if (chunks.length === 0) throw notFound('Document has no indexed content');
    const context = chunks
      .map((c, i) => `[${i + 1}] (page ${c.page_start}${c.clause_title ? ` | heading: ${c.clause_title}` : ''})\n${c.content}`)
      .join('\n\n');
    const res = await this.deps.llm.generate({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', parts: [{ text: `Passages:\n\n${context}\n\nProduce the outline as JSON.` }] }],
      responseSchema: jsonSchema(),
      temperature: 0,
      maxOutputTokens: 2048,
      model: this.deps.model,
    });
    let parsed: z.infer<typeof OutlineOutputSchema>;
    try {
      parsed = OutlineOutputSchema.parse(JSON.parse(res.text ?? ''));
    } catch {
      throw new HttpError(502, 'LLM_BAD_RESPONSE', 'Outline was not in the expected shape');
    }
    const outline = OutlineSchema.parse({
      title: parsed.title,
      summary: parsed.summary,
      sections: parsed.sections.map((s) => {
        const c = s.ref !== null && s.ref >= 1 && s.ref <= chunks.length ? chunks[s.ref - 1] : undefined;
        return {
          heading: s.heading,
          gist: s.gist,
          citation: c ? { chunkId: c.id, page: c.page_start, pageEnd: c.page_end, clauseTitle: c.clause_title, quote: quoteFrom(c.content) } : null,
        };
      }),
    });
    await this.deps.db.query('UPDATE documents SET outline = $2 WHERE id = $1', [doc.id, JSON.stringify(outline)]);
    this.deps.logger.info({ documentId: doc.id, ms: Date.now() - started, sections: outline.sections.length }, 'outline built');
    return outline;
  }
}
