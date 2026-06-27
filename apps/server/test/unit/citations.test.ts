import { describe, expect, it } from 'vitest';
import { parseAnswer } from '../../src/qa/citations.js';
import { formatContext } from '../../src/qa/prompt.js';
import type { RetrievedChunk } from '../../src/retrieval/search.js';

const chunk = (i: number, content: string, clause: string | null = `${i}. CLAUSE`, page = i): RetrievedChunk => ({
  id: `chunk-${i}`,
  document_id: 'doc',
  chunk_index: i,
  page_start: page,
  page_end: page,
  clause_title: clause,
  content,
  token_count: 10,
  score: 0,
  ranks: {},
});

const chunks = [
  chunk(1, '5. FEES\nThe Borrower shall pay a processing fee of 2% of the loan amount. It is deducted at disbursement.'),
  chunk(2, '6. PREPAYMENT\nPrepayment charge of 4% applies after the twelfth EMI; no prepayment is permitted before that.'),
  chunk(3, '7. DEFAULT\nPenal interest of 2% per month accrues on overdue amounts.'),
];

describe('parseAnswer', () => {
  it('resolves markers to citations with page, clause and a quote from the chunk', () => {
    const r = parseAnswer('The processing fee is 2% [1] and prepayment costs 4% [2].', chunks);
    expect(r.grounded).toBe(true);
    expect(r.notFound).toBe(false);
    expect(r.citations).toEqual([
      { ref: 1, chunkId: 'chunk-1', page: 1, pageEnd: 1, clauseTitle: '1. CLAUSE', quote: 'The Borrower shall pay a processing fee of 2% of the loan amount.' },
      { ref: 2, chunkId: 'chunk-2', page: 2, pageEnd: 2, clauseTitle: '2. CLAUSE', quote: 'Prepayment charge of 4% applies after the twelfth EMI; no prepayment is permitted before that.' },
    ]);
    expect(r.answer).toBe('The processing fee is 2% [1] and prepayment costs 4% [2].');
  });

  it('handles grouped markers and dedupes repeated references', () => {
    const r = parseAnswer('Fees and prepayment are covered [1, 2]. Again [1].', chunks);
    expect(r.citations.map((c) => c.ref)).toEqual([1, 2]);
  });

  it('drops markers that point outside the provided context', () => {
    const r = parseAnswer('Something [7] and real [3].', chunks);
    expect(r.answer).toBe('Something and real [3].');
    expect(r.citations.map((c) => c.ref)).toEqual([3]);
  });

  it('marks answers without any citation as ungrounded but keeps the text', () => {
    const r = parseAnswer('Loans usually have fees.', chunks);
    expect(r.grounded).toBe(false);
    expect(r.citations).toEqual([]);
    expect(r.answer).toBe('Loans usually have fees.');
  });

  it('recognises the not-in-document sentinel', () => {
    const r = parseAnswer('NOT_IN_DOCUMENT\nThe agreement does not mention a cooling-off period.', chunks);
    expect(r.notFound).toBe(true);
    expect(r.grounded).toBe(true);
    expect(r.citations).toEqual([]);
    expect(r.answer).toBe('The agreement does not mention a cooling-off period.');
    expect(parseAnswer('NOT_IN_DOCUMENT', chunks).answer).toBe('The document does not appear to state this.');
  });

  it('does not treat "Rs." as the end of a sentence', () => {
    const r = parseAnswer('x [1]', [chunk(1, 'B. LOAN\nThe loan amount is Rs. 5,00,000. Processing fee 2%.')]);
    expect(r.citations[0]!.quote).toBe('The loan amount is Rs. 5,00,000.');
  });

  it('falls back to the start of a chunk when there is no sentence boundary', () => {
    const r = parseAnswer('x [1]', [chunk(1, 'short text without punctuation', null)]);
    expect(r.citations[0]!.quote).toBe('short text without punctuation');
    expect(r.citations[0]!.clauseTitle).toBeNull();
  });
});

describe('formatContext', () => {
  it('numbers passages and labels pages and clauses', () => {
    const ctx = formatContext([chunks[0]!, { ...chunks[1]!, page_end: 3 }]);
    expect(ctx).toContain('[1] (page 1 | clause: 1. CLAUSE)\n5. FEES');
    expect(ctx).toContain('[2] (pages 2-3 | clause: 2. CLAUSE)');
  });
});
