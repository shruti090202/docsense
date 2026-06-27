import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChunkRow } from '../../src/db/documents.js';
import { salvage, toLoanTerms } from '../../src/extraction/service.js';
import { extractionJsonSchema } from '../../src/extraction/schema.js';
import { parsePdf } from '../../src/ingest/pdf.js';
import { maskAndChunk } from '../../src/ingest/pipeline.js';
import { TOOL_DEFINITIONS, executeTool } from '../../src/qa/tools.js';
import type { RetrievedChunk } from '../../src/retrieval/search.js';
import { findCandidates } from '../../src/risks/service.js';

const samples = path.resolve(import.meta.dirname, '../../../../samples');

describe('calculator tools', () => {
  it('declares JSON-schema parameters without the $schema marker', () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toEqual(['calculate_emi', 'calculate_total_cost', 'calculate_effective_annual_rate', 'sum_amounts', 'percent_of']);
    for (const t of TOOL_DEFINITIONS) {
      expect(t.parameters['$schema']).toBeUndefined();
      expect(t.parameters['type']).toBe('object');
      expect(t.parameters['properties']).toBeTypeOf('object');
    }
  });

  it('computes EMI, totals, effective rate and percentages deterministically', () => {
    expect(executeTool('calculate_emi', { principal: 500000, annualRatePercent: 14, tenureMonths: 36 })).toMatchObject({ emi: 17088.81, method: 'reducing' });
    expect(executeTool('calculate_emi', { principal: 800000, annualRatePercent: 9.5, tenureMonths: 60, method: 'flat' })).toMatchObject({ emi: 19666.67 });
    expect(executeTool('calculate_total_cost', { principal: 500000, emi: 17088.81, tenureMonths: 36, upfrontFees: 18300 })).toEqual({
      totalRepayment: 615197.16,
      totalInterest: 115197.16,
      upfrontFees: 18300,
      totalCostOfCredit: 133497.16,
      currency: 'INR',
    });
    const eff = executeTool('calculate_effective_annual_rate', { principal: 500000, annualRatePercent: 14, tenureMonths: 36, upfrontFees: 18300, statedEmi: 17088.81 });
    expect(eff['emi']).toBe(17088.81);
    expect(eff['netDisbursal']).toBe(481700);
    expect(eff['aprPercent']).toBeGreaterThan(14);
    expect(executeTool('percent_of', { percent: 2, amount: 500000 })).toEqual({ result: 10000 });
    expect(executeTool('sum_amounts', { amounts: [8000, 1500, 600, 400] })).toEqual({ total: 10500 });
  });

  it('returns a readable error for bad arguments instead of throwing', () => {
    const r = executeTool('calculate_emi', { principal: -1, annualRatePercent: 14, tenureMonths: 36 });
    expect(String(r['error'])).toContain('principal');
    expect(executeTool('nope', {})).toEqual({ error: 'unknown tool nope' });
    expect(String(executeTool('calculate_effective_annual_rate', { principal: 1000, annualRatePercent: 10, tenureMonths: 12, upfrontFees: 1000 })['error'])).toMatch(/upfront fees/);
  });
});

const chunk = (i: number, content: string): RetrievedChunk => ({
  id: `c${i}`,
  document_id: 'd',
  chunk_index: i,
  page_start: i,
  page_end: i,
  clause_title: `${i}. T`,
  content,
  token_count: 1,
  score: 0,
  ranks: {},
});

describe('extraction output handling', () => {
  const good = {
    lenderName: { value: 'Meridian Finance Limited', ref: 1, confidence: 1 },
    principalAmount: { value: 500000, ref: 2, confidence: 1 },
    interestRate: { annualPercent: 14, rateType: 'fixed', method: 'reducing', benchmark: null, ref: 3, confidence: 1 },
    tenureMonths: { value: 36, ref: 3, confidence: 0.9 },
    statedEmi: { value: 17088.81, ref: 3, confidence: 1 },
    processingFee: { amount: null, percent: 2, description: '2% plus GST', ref: 2, confidence: 1 },
    insurancePremium: { amount: 6500, percent: null, description: 'credit life', ref: 2, confidence: 0.8 },
    otherUpfrontCharges: [{ amount: 1800, percent: null, description: 'GST on processing fee', ref: 2, confidence: 0.7 }],
    prepaymentCharges: { amount: null, percent: 4, description: 'after 12 EMIs', ref: 3, confidence: 1 },
    latePaymentCharges: { amount: null, percent: 2, description: 'per month', ref: 3, confidence: 1 },
    bounceCharges: { amount: null, percent: null, description: null, ref: null, confidence: 0 },
  };
  const chunks = [chunk(1, 'A. LENDER\nMeridian Finance Limited is the lender.'), chunk(2, 'B. LOAN\nThe loan amount is Rs. 5,00,000. Processing fee 2%.'), chunk(3, 'C. TERMS\nInterest 14% p.a. over 36 months, EMI Rs. 17,088.81.')];

  it('maps refs to citations and marks unstated fields not found', () => {
    const terms = toLoanTerms(salvage(good), chunks);
    expect(terms.principal).toMatchObject({ amount: 500000, notFound: false, confidence: 1 });
    expect(terms.principal.citation).toMatchObject({ chunkId: 'c2', page: 2, clauseTitle: '2. T', quote: 'The loan amount is Rs. 5,00,000.' });
    expect(terms.bounceCharges).toMatchObject({ amount: null, percent: null, notFound: true, confidence: 0, citation: null });
    expect(terms.otherUpfrontCharges[0]!.citation?.page).toBe(2);
    expect(terms.interestRate.rateType).toBe('fixed');
  });

  it('drops citations whose ref points outside the context', () => {
    const terms = toLoanTerms(salvage({ ...good, tenureMonths: { value: 36, ref: 9, confidence: 1 } }), chunks);
    expect(terms.tenureMonths.value).toBe(36);
    expect(terms.tenureMonths.citation).toBeNull();
  });

  it('salvages valid fields when the whole object is malformed', () => {
    const broken = { ...good, principalAmount: { value: 'five lakh', ref: 2, confidence: 1 }, interestRate: 'fourteen', otherUpfrontCharges: 'none' };
    const out = salvage(broken);
    expect(out.lenderName.value).toBe('Meridian Finance Limited');
    expect(out.principalAmount).toEqual({ value: null, ref: null, confidence: 0 });
    expect(out.interestRate.rateType).toBe('unknown');
    expect(out.otherUpfrontCharges).toEqual([]);
    expect(salvage(null).tenureMonths.value).toBeNull();
    expect(salvage('garbage').processingFee.amount).toBeNull();
  });

  it('produces a JSON schema Gemini can consume', () => {
    const schema = extractionJsonSchema();
    expect(schema['$schema']).toBeUndefined();
    expect(schema['type']).toBe('object');
    expect(Object.keys(schema['properties'] as object)).toContain('prepaymentCharges');
  });
});

describe('risk pre-filter', () => {
  it('produces a candidate for every ground-truth risk in every sample', async () => {
    for (const slug of ['personal-loan-fixed', 'home-loan-floating', 'vehicle-loan-flat', 'business-loan-kfs', 'education-loan-floating']) {
      const truth = JSON.parse(await readFile(path.join(samples, 'ground-truth', `${slug}.json`), 'utf8'));
      const parsed = await parsePdf(await readFile(path.join(samples, 'pdf', `${slug}.pdf`)), { maxPages: 60 });
      const { chunks } = maskAndChunk(parsed);
      const rows: ChunkRow[] = chunks.map((c) => ({
        id: `${slug}-${c.index}`,
        document_id: slug,
        chunk_index: c.index,
        page_start: c.pageStart,
        page_end: c.pageEnd,
        clause_title: c.clauseTitle,
        content: c.content,
        token_count: c.tokenCount,
      }));
      const candidates = findCandidates(rows);
      for (const risk of truth.risks as { category: string; pages: number[] }[]) {
        const hit = candidates.find((c) => c.category === risk.category && risk.pages.some((p) => p >= c.chunk.page_start && p <= c.chunk.page_end));
        expect(hit, `${slug}: ${risk.category} on pages ${risk.pages}`).toBeDefined();
      }
      const perCategory = new Map<string, number>();
      for (const c of candidates) perCategory.set(c.category, (perCategory.get(c.category) ?? 0) + 1);
      for (const n of perCategory.values()) expect(n).toBeLessThanOrEqual(2);
    }
  });

  it('ranks the strongest match first within a category', () => {
    const rows: ChunkRow[] = [
      { id: 'a', document_id: 'd', chunk_index: 0, page_start: 1, page_end: 1, clause_title: null, content: 'Disputes go to arbitration.', token_count: 1 },
      { id: 'b', document_id: 'd', chunk_index: 1, page_start: 2, page_end: 2, clause_title: null, content: 'The Lender may terminate without notice and take possession of the vehicle; the Borrower has no corresponding right.', token_count: 1 },
    ];
    const c = findCandidates(rows);
    expect(c.find((x) => x.category === 'one_sided_termination')?.chunk.id).toBe('b');
    expect(c.find((x) => x.category === 'one_sided_termination')?.matches).toBe(3);
    expect(c.find((x) => x.category === 'arbitration')?.chunk.id).toBe('a');
    expect(c.some((x) => x.category === 'penal_interest')).toBe(false);
  });
});
