import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChunkRow } from '../../src/db/documents.js';
import { salvageContract, toContractFacts } from '../../src/extraction/contractFacts.js';
import { classifyDocument } from '../../src/ingest/classify.js';
import { parsePdf } from '../../src/ingest/pdf.js';
import { maskAndChunk } from '../../src/ingest/pipeline.js';
import type { RetrievedChunk } from '../../src/retrieval/search.js';
import { categoriesFor, findCandidates } from '../../src/risks/service.js';

const samples = path.resolve(import.meta.dirname, '../../../../samples');

async function chunksOf(slug: string) {
  const parsed = await parsePdf(await readFile(path.join(samples, 'pdf', `${slug}.pdf`)), { maxPages: 60 });
  return maskAndChunk(parsed).chunks;
}

describe('classifyDocument', () => {
  it('labels every sample with its ground-truth kind', async () => {
    const expected: Record<string, string> = {
      'personal-loan-fixed': 'loan',
      'home-loan-floating': 'loan',
      'vehicle-loan-flat': 'loan',
      'business-loan-kfs': 'loan',
      'education-loan-floating': 'loan',
      'residential-lease': 'contract',
      'lecture-notes-tvm': 'general',
    };
    for (const [slug, kind] of Object.entries(expected)) {
      const chunks = await chunksOf(slug);
      expect(classifyDocument(chunks.map((c) => c.content).join('\n')).kind, slug).toBe(kind);
    }
  });

  it('does not mistake notes about loans for a loan agreement', async () => {
    const chunks = await chunksOf('lecture-notes-tvm');
    const c = classifyDocument(chunks.map((x) => x.content).join('\n'));
    expect(c.loanSignals).toBeGreaterThanOrEqual(5);
    expect(c.kind).toBe('general');
  });

  it('treats an agreement without credit vocabulary as a contract', () => {
    const text = `This Service Agreement is made between Acme Pvt Ltd (the "Company") and Riya Sen (the "Contractor"). WHEREAS the parties agree as follows. The Contractor shall deliver the services. Either party may terminate on 30 days notice. The Contractor shall indemnify the Company. Governing law: India. Fees shall be paid monthly. Notice shall be in writing. The parties hereinafter agree that confidential information shall not be disclosed.`;
    expect(classifyDocument(text).kind).toBe('contract');
    expect(classifyDocument('Shopping list: milk, eggs, bread. Call the plumber on Tuesday.').kind).toBe('general');
  });
});

const chunk = (i: number, content: string): RetrievedChunk => ({ id: `c${i}`, document_id: 'd', chunk_index: i, page_start: i, page_end: i, clause_title: `${i}.`, content, token_count: 1, score: 0, ranks: {} });

describe('contract facts handling', () => {
  it('maps refs to citations and marks missing facts not found', () => {
    const out = salvageContract({
      documentType: { value: 'Leave and Licence Agreement', ref: 1, confidence: 1 },
      parties: { value: ['Sunita Deshpande (Licensor)', 'Kabir Malhotra (Licensee)'], ref: 1, confidence: 1 },
      effectiveDate: { value: '1 August 2026', ref: 1, confidence: 1 },
      term: { value: '24 months', ref: 2, confidence: 0.9 },
      paymentObligations: { value: 'Rs. 38,000 per month', ref: 2, confidence: 1 },
      securityDeposit: { value: null, ref: null, confidence: 0 },
      noticePeriod: 'sixty days',
      terminationConditions: { value: 'Licensor may terminate on 15 days notice', ref: 9, confidence: 0.8 },
    });
    const facts = toContractFacts(out, [chunk(1, 'A.\nThis Agreement is made between the parties on 1 August 2026.'), chunk(2, 'B.\nThe term is 24 months and the fee is Rs. 38,000 per month.')]);
    expect(facts.parties.value).toHaveLength(2);
    expect(facts.parties.citation?.page).toBe(1);
    expect(facts.term.citation?.quote).toBe('The term is 24 months and the fee is Rs. 38,000 per month.');
    expect(facts.securityDeposit.notFound).toBe(true);
    expect(facts.noticePeriod.notFound).toBe(true);
    expect(facts.terminationConditions.value).toContain('15 days');
    expect(facts.terminationConditions.citation).toBeNull();
    expect(facts.renewal.notFound).toBe(true);
    expect(facts.governingLaw.confidence).toBe(0);
  });
});

describe('risk categories by kind', () => {
  it('uses loan categories for loans, contract categories for contracts, none for general documents', () => {
    expect(categoriesFor('loan')).toContain('auto_debit_mandate');
    expect(categoriesFor('loan')).not.toContain('lock_in');
    expect(categoriesFor('contract')).toContain('lock_in');
    expect(categoriesFor('contract')).not.toContain('auto_debit_mandate');
    expect(categoriesFor('general')).toEqual([]);
  });

  it('pre-filter finds every ground-truth risk in the lease sample and none of the loan-only ones', async () => {
    const truth = JSON.parse(await readFile(path.join(samples, 'ground-truth', 'residential-lease.json'), 'utf8'));
    const chunks = await chunksOf('residential-lease');
    const rows: ChunkRow[] = chunks.map((c) => ({ id: String(c.index), document_id: 'd', chunk_index: c.index, page_start: c.pageStart, page_end: c.pageEnd, clause_title: c.clauseTitle, content: c.content, token_count: c.tokenCount }));
    const candidates = findCandidates(rows, categoriesFor('contract'));
    const found = new Set(candidates.map((c) => c.category));
    for (const r of truth.risks as string[]) {
      const pages = truth.tagPages[`risk:${r}`] as number[];
      const onPage = candidates.some((c) => c.category === r && pages.some((p) => p >= c.chunk.page_start && p <= c.chunk.page_end));
      expect(onPage, `${r} on pages ${pages}`).toBe(true);
    }
    expect(found.has('auto_debit_mandate')).toBe(false);
    expect(found.has('non_compete')).toBe(false);
  });
});
