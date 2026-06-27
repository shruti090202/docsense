import type { Citation } from '@docsense/shared';
import { SENTENCE_BOUNDARY } from '../ingest/chunker.js';
import type { RetrievedChunk } from '../retrieval/search.js';
import { NOT_IN_DOCUMENT } from './prompt.js';

export interface ParsedAnswer {
  answer: string;
  citations: Citation[];
  grounded: boolean;
  notFound: boolean;
}

// First sentence of a chunk body (after the clause title line), used as the human-readable quote.
export function quoteFrom(text: string, max = 220): string {
  const body = text.includes('\n') ? text.slice(text.indexOf('\n') + 1) : text;
  const m = new RegExp(`^(.{20,}?)${SENTENCE_BOUNDARY.source}`).exec(body);
  const s = (m ? m[1]! : body).trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// Turns "[2]" / "[1, 3]" markers into citations resolved against the retrieved chunks, dropping
// markers that point outside the context (a model hallucinating a passage number).
export function parseAnswer(raw: string, chunks: RetrievedChunk[]): ParsedAnswer {
  const text = raw.trim();
  if (text.startsWith(NOT_IN_DOCUMENT)) {
    const explanation = text.slice(NOT_IN_DOCUMENT.length).replace(/^[\s:.-]+/, '').trim();
    return {
      answer: explanation || 'The document does not appear to state this.',
      citations: [],
      grounded: true,
      notFound: true,
    };
  }
  const used = new Set<number>();
  const answer = text.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (_m, list: string) => {
    const kept = list
      .split(',')
      .map((n) => Number(n.trim()))
      .filter((n) => n >= 1 && n <= chunks.length);
    kept.forEach((n) => used.add(n));
    return kept.length ? `[${kept.join(', ')}]` : '';
  });
  const citations: Citation[] = [...used]
    .sort((a, b) => a - b)
    .map((n) => {
      const c = chunks[n - 1]!;
      return { ref: n, chunkId: c.id, page: c.page_start, pageEnd: c.page_end, clauseTitle: c.clause_title, quote: quoteFrom(c.content) };
    });
  const cleaned = answer.replace(/ {2,}/g, ' ').replace(/\s+([.,;])/g, '$1').trim();
  return { answer: cleaned, citations, grounded: citations.length > 0, notFound: false };
}
