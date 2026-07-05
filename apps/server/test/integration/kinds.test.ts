import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { jsonResponse, textResponse } from '../../src/llm/fake.js';
import type { GenerateRequest } from '../../src/llm/types.js';
import { createTestContext, samplePdf, sampleTruth, truncateAll, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await truncateAll(ctx.db);
  ctx.llm.generateCalls.length = 0;
  ctx.llm.setHandler(() => textResponse('fake answer'));
});

async function upload(slug: string) {
  const res = await request(ctx.app).post('/api/documents').attach('file', await samplePdf(slug), `${slug}.pdf`).expect(201);
  return res.body as { documentId: string; kind: string; piiMap: Record<string, string> };
}

const passageOf = (prompt: string, needle: RegExp): number | null => {
  const blocks = prompt.split(/\n(?=\[\d+\] \()/);
  const hit = blocks.find((b) => needle.test(b));
  return hit ? Number(/^\[(\d+)\]/.exec(hit.trim())?.[1] ?? null) : null;
};

describe('contract documents', () => {
  it('classifies the lease as a contract, masks the tenant, extracts key facts with citations and reviews contract risks', async () => {
    const truth = await sampleTruth('residential-lease');
    const doc = await upload('residential-lease');
    expect(doc.kind).toBe('contract');
    expect(Object.values(doc.piiMap)).toEqual(expect.arrayContaining([truth.pii.pan, truth.pii.ifsc]));

    ctx.llm.setHandler((req: GenerateRequest) => {
      const prompt = (req.messages[0]!.parts[0] as { text: string }).text;
      if (/Extract the key facts/.test(prompt)) {
        return jsonResponse({
          documentType: { value: 'Leave and Licence Agreement', ref: passageOf(prompt, /Leave and Licence Agreement/), confidence: 1 },
          parties: { value: ['Sunita Deshpande (Licensor)', 'Kabir Malhotra (Licensee)'], ref: passageOf(prompt, /Licensor/), confidence: 1 },
          effectiveDate: { value: '1 August 2026', ref: passageOf(prompt, /1 August 2026/), confidence: 1 },
          term: { value: '24 months', ref: passageOf(prompt, /24 months/), confidence: 1 },
          paymentObligations: { value: 'Rs. 38,000 per month', ref: passageOf(prompt, /38,000/), confidence: 1 },
          securityDeposit: { value: 'Rs. 2,28,000', ref: passageOf(prompt, /2,28,000/), confidence: 1 },
          noticePeriod: { value: '60 days', ref: passageOf(prompt, /60 days' written notice/), confidence: 0.9 },
          terminationConditions: { value: 'Licensor may terminate on 15 days notice or immediately on breach', ref: passageOf(prompt, /15 days/), confidence: 0.9 },
          renewal: { value: 'Automatic 12 months at +10% unless 90 days notice', ref: passageOf(prompt, /automatically renew/i), confidence: 1 },
          governingLaw: { value: 'India; arbitration at Pune', ref: passageOf(prompt, /arbitrat/i), confidence: 1 },
        });
      }
      const n = (prompt.match(/^Candidate \d+ \|/gm) ?? []).length;
      return jsonResponse({ reviews: Array.from({ length: n }, (_, i) => ({ candidate: i + 1, present: true, severity: 'medium', title: `Risk ${i + 1}`, explanation: 'Explains the clause in plain words for the tenant.' })) });
    });

    const analysis = await request(ctx.app).post(`/api/documents/${doc.documentId}/extract`).expect(200);
    expect(analysis.body.kind).toBe('contract');
    expect(analysis.body.terms).toBeNull();
    expect(analysis.body.contractFacts.parties.value).toHaveLength(2);
    expect(analysis.body.contractFacts.securityDeposit.citation.page).toBeGreaterThanOrEqual(1);
    expect(analysis.body.contractFacts.renewal.value).toMatch(/Automatic/);
    expect(ctx.llm.generateCalls[0]!.system).toMatch(/key facts of an agreement/);

    const risks = await request(ctx.app).post(`/api/documents/${doc.documentId}/risks`).expect(200);
    const categories = risks.body.riskFlags.map((f: { category: string }) => f.category);
    for (const r of truth.risks) expect(categories).toContain(r);
    expect(categories).not.toContain('auto_debit_mandate');

    const summary = await request(ctx.app).get(`/api/documents/${doc.documentId}`).expect(200);
    expect(summary.body.kind).toBe('contract');
    expect(summary.body.contractFacts.term.value).toBe('24 months');
    expect(summary.body.extraction).toBeNull();
    expect(summary.body.cost).toBeNull();
  });

  it('refuses to compare non-loan documents', async () => {
    const lease = await upload('residential-lease');
    const loan = await upload('personal-loan-fixed');
    const res = await request(ctx.app).post('/api/compare').send({ leftId: lease.documentId, rightId: loan.documentId }).expect(400);
    expect(res.body.error.code).toBe('KIND_NOT_SUPPORTED');
  });
});

describe('general documents', () => {
  it('classifies notes as general, builds a cited outline and skips the risk review', async () => {
    const truth = await sampleTruth('lecture-notes-tvm');
    const doc = await upload('lecture-notes-tvm');
    expect(doc.kind).toBe('general');
    expect(doc.piiMap).toEqual({});

    ctx.llm.setHandler((req: GenerateRequest) => {
      const prompt = (req.messages[0]!.parts[0] as { text: string }).text;
      const sections = (truth.outlineHeadings as string[]).map((h) => ({ heading: h, gist: `About ${h.toLowerCase()}.`, ref: passageOf(prompt, new RegExp(h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))) }));
      return jsonResponse({ title: 'Lecture 6: Time Value of Money', summary: 'Notes on discounting, annuities, EMIs and effective rates.', sections });
    });
    const analysis = await request(ctx.app).post(`/api/documents/${doc.documentId}/extract`).expect(200);
    expect(analysis.body.kind).toBe('general');
    expect(analysis.body.outline.sections.map((s: { heading: string }) => s.heading)).toEqual(truth.outlineHeadings);
    expect(analysis.body.outline.sections.every((s: { citation: unknown }) => s.citation !== null)).toBe(true);
    expect(analysis.body.contractFacts).toBeNull();

    const risks = await request(ctx.app).post(`/api/documents/${doc.documentId}/risks`).expect(200);
    expect(risks.body.riskFlags).toEqual([]);
    expect(ctx.llm.generateCalls).toHaveLength(1);

    ctx.llm.setHandler(() => textResponse('The EMI formula is P x r x (1 + r)^n / [(1 + r)^n - 1] [3].'));
    const ask = await request(ctx.app).post(`/api/documents/${doc.documentId}/ask`).send({ question: 'What is the EMI formula?' }).expect(200);
    expect(ask.body.citations).toHaveLength(1);
  });
});
