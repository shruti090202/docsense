import { describe, expect, it } from 'vitest';
import { chunkDocument, estimateTokens, isHeading } from '../../src/ingest/chunker.js';

const sentence = (i: number) => `The Borrower shall comply with obligation number ${i} as described in this clause without exception.`;
const paragraph = (n: number, from = 1) => Array.from({ length: n }, (_, i) => sentence(from + i)).join(' ');

describe('isHeading', () => {
  it.each([
    '1. DEFINITIONS',
    '5.2 Prepayment Charges',
    '12.3.1 Notices',
    'ARTICLE III - INTEREST',
    'Clause 7. Default and Penal Charges',
    'SECTION B: FEES AND CHARGES',
    'SCHEDULE I - PARTICULARS OF THE LOAN',
    'REPRESENTATIONS AND WARRANTIES',
    'Annexure A',
  ])('accepts "%s"', (line) => {
    expect(isHeading(line)).toBe(true);
  });

  it.each([
    '5. The Borrower shall repay the Loan together with interest in 36 equated monthly instalments.',
    'Interest shall accrue at 14% per annum.',
    'Rs. 5,00,000',
    'INR 1,00,000',
    'EMI',
    '2026',
    'the borrower agrees to the terms',
    'A'.repeat(90),
  ])('rejects "%s"', (line) => {
    expect(isHeading(line)).toBe(false);
  });
});

describe('chunkDocument', () => {
  it('splits on clause headings and records the clause title', () => {
    const pages = [
      { page: 1, text: `1. DEFINITIONS\n${paragraph(3)}\n2. THE LOAN\n${paragraph(3)}` },
      { page: 2, text: `3. INTEREST\n${paragraph(3)}` },
    ];
    const chunks = chunkDocument(pages, { minTokens: 10 });
    expect(chunks.map((c) => c.clauseTitle)).toEqual(['1. DEFINITIONS', '2. THE LOAN', '3. INTEREST']);
    expect(chunks.map((c) => [c.pageStart, c.pageEnd])).toEqual([
      [1, 1],
      [1, 1],
      [2, 2],
    ]);
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(chunks[0]!.content.startsWith('1. DEFINITIONS')).toBe(true);
  });

  it('puts text before the first heading in a chunk with no clause title', () => {
    const chunks = chunkDocument([{ page: 1, text: `${paragraph(3)}\n1. DEFINITIONS\n${paragraph(3)}` }], { minTokens: 10 });
    expect(chunks[0]!.clauseTitle).toBeNull();
    expect(chunks[1]!.clauseTitle).toBe('1. DEFINITIONS');
  });

  it('caps chunk size, overlaps windows and repeats the clause title as context', () => {
    const long = paragraph(40);
    const chunks = chunkDocument([{ page: 1, text: `4. COVENANTS\n${long}` }], { maxTokens: 120, overlapTokens: 30, minTokens: 10 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(c.tokenCount).toBeLessThanOrEqual(120 + estimateTokens('4. COVENANTS'));
      expect(c.clauseTitle).toBe('4. COVENANTS');
    }
    expect(chunks[1]!.content.startsWith('4. COVENANTS\n')).toBe(true);
    // the last sentence of one window reappears at the start of the next
    const lastSentence = chunks[0]!.content.split(/(?<=\.)\s+/).at(-1)!;
    expect(chunks[1]!.content).toContain(lastSentence);
  });

  it('tracks page boundaries inside a split clause', () => {
    const pages = [
      { page: 3, text: `9. EVENTS OF DEFAULT\n${paragraph(20)}` },
      { page: 4, text: paragraph(20, 21) },
    ];
    const chunks = chunkDocument(pages, { maxTokens: 150, overlapTokens: 20, minTokens: 10 });
    expect(chunks[0]!.pageStart).toBe(3);
    expect(chunks.at(-1)!.pageEnd).toBe(4);
    expect(chunks.some((c) => c.pageStart === 3 && c.pageEnd === 4)).toBe(true);
  });

  it('folds a body-less heading into the following section', () => {
    const chunks = chunkDocument([{ page: 1, text: `ARTICLE III - INTEREST\n3.1 Rate of Interest\n${paragraph(3)}` }], { minTokens: 20 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.clauseTitle).toBe('ARTICLE III - INTEREST > 3.1 Rate of Interest');
  });

  it('ignores blank lines and collapses whitespace', () => {
    const chunks = chunkDocument([{ page: 1, text: `\n\n1. DEFINITIONS\n\n   The   Loan  means   money.  \n\n` }], { minTokens: 1 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe('1. DEFINITIONS\nThe Loan means money.');
  });

  it('returns no chunks for empty input', () => {
    expect(chunkDocument([{ page: 1, text: '' }])).toEqual([]);
  });
});
