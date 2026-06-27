import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { jsonResponse, textResponse } from '../../src/llm/fake.js';
import type { GenerateRequest, GenerateResponse } from '../../src/llm/types.js';
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
  return res.body as { documentId: string };
}

function functionCallResponse(name: string, args: Record<string, unknown>): GenerateResponse {
  return { text: null, functionCalls: [{ name, args }], parts: [{ functionCall: { name, args } }], usage: { inputTokens: 0, outputTokens: 0 }, model: 'fake-chat' };
}

// A handler that mimics a reasonable extraction from whatever passages it is given.
function fakeExtraction(req: GenerateRequest): GenerateResponse {
  const prompt = (req.messages[0]!.parts[0] as { text: string }).text;
  const passageOf = (needle: RegExp) => {
    const blocks = prompt.split(/\n(?=\[\d+\] \()/);
    const hit = blocks.find((b) => needle.test(b));
    return hit ? Number(/^\[(\d+)\]/.exec(hit.trim())?.[1] ?? null) : null;
  };
  return jsonResponse({
    lenderName: { value: 'Meridian Finance Limited', ref: passageOf(/Meridian Finance Limited/), confidence: 1 },
    principalAmount: { value: 500000, ref: passageOf(/Rs\. 5,00,000/), confidence: 1 },
    interestRate: { annualPercent: 14, rateType: 'fixed', method: 'reducing', benchmark: null, ref: passageOf(/14% per annum/), confidence: 1 },
    tenureMonths: { value: 36, ref: passageOf(/36 equated monthly/), confidence: 1 },
    statedEmi: { value: 17088.81, ref: passageOf(/17,088\.81/), confidence: 1 },
    processingFee: { amount: null, percent: 2, description: '2% plus GST', ref: passageOf(/processing fee of 2%/i), confidence: 1 },
    insurancePremium: { amount: 6500, percent: null, description: 'Credit life insurance premium', ref: passageOf(/6,500/), confidence: 0.9 },
    otherUpfrontCharges: [{ amount: 1800, percent: null, description: 'GST on processing fee', ref: passageOf(/GST on processing fee/), confidence: 0.8 }],
    prepaymentCharges: { amount: null, percent: 4, description: '4% of principal outstanding after 12 EMIs', ref: passageOf(/prepayment charge of 4%/i), confidence: 1 },
    latePaymentCharges: { amount: null, percent: 2, description: '2% per month on overdue', ref: passageOf(/2% per month/), confidence: 1 },
    bounceCharges: { amount: 500, percent: null, description: 'per dishonoured instrument', ref: passageOf(/Rs\. 500 per dishonoured/), confidence: 1 },
  });
}

describe('tool calling in /ask', () => {
  it('runs the calculator the model asks for and feeds the result back', async () => {
    const doc = await upload('personal-loan-fixed');
    const seen: GenerateRequest[] = [];
    ctx.llm.setHandler((req, i) => {
      seen.push(req);
      if (i === 0) return functionCallResponse('calculate_effective_annual_rate', { principal: 500000, annualRatePercent: 14, tenureMonths: 36, upfrontFees: 18300, statedEmi: 17088.81 });
      const toolPart = req.messages.at(-1)!.parts[0] as { functionResponse: { name: string; response: Record<string, unknown> } };
      const apr = toolPart.functionResponse.response['aprPercent'];
      return textResponse(`Including fees the loan costs about ${apr}% APR [1].`);
    });
    const res = await request(ctx.app).post(`/api/documents/${doc.documentId}/ask`).send({ question: 'What is the true annual cost including fees?' }).expect(200);
    expect(res.body.toolCalls).toHaveLength(1);
    expect(res.body.toolCalls[0].name).toBe('calculate_effective_annual_rate');
    expect(res.body.toolCalls[0].result.emi).toBe(17088.81);
    expect(res.body.toolCalls[0].result.aprPercent).toBeGreaterThan(14);
    expect(res.body.answer).toContain(`${res.body.toolCalls[0].result.aprPercent}% APR`);
    expect(res.body.grounded).toBe(true);
    expect(seen[0]!.tools?.map((t) => t.name)).toContain('calculate_emi');
    expect(seen[1]!.messages.at(-2)!.role).toBe('model');
    expect(seen[1]!.messages.at(-1)!.role).toBe('user');
  });

  it('returns validation errors to the model and lets it correct itself', async () => {
    const doc = await upload('personal-loan-fixed');
    ctx.llm.setHandler((req, i) => {
      if (i === 0) return functionCallResponse('calculate_emi', { principal: -5, annualRatePercent: 14, tenureMonths: 36 });
      if (i === 1) {
        const toolPart = req.messages.at(-1)!.parts[0] as { functionResponse: { response: Record<string, unknown> } };
        expect(String(toolPart.functionResponse.response['error'])).toContain('principal');
        return functionCallResponse('calculate_emi', { principal: 500000, annualRatePercent: 14, tenureMonths: 36 });
      }
      return textResponse('The EMI works out to Rs. 17,088.81 [1].');
    });
    const res = await request(ctx.app).post(`/api/documents/${doc.documentId}/ask`).send({ question: 'What should the EMI be?' }).expect(200);
    expect(res.body.toolCalls.map((t: { name: string }) => t.name)).toEqual(['calculate_emi', 'calculate_emi']);
    expect(res.body.toolCalls[1].result.emi).toBe(17088.81);
  });

  it('gives up after too many tool rounds', async () => {
    const doc = await upload('personal-loan-fixed');
    ctx.llm.setHandler(() => functionCallResponse('percent_of', { percent: 2, amount: 100 }));
    const res = await request(ctx.app).post(`/api/documents/${doc.documentId}/ask`).send({ question: 'loop?' }).expect(502);
    expect(res.body.error.code).toBe('LLM_TOOL_LOOP');
  });
});

describe('POST /api/documents/:id/extract', () => {
  it('extracts terms with citations, computes the cost and stores the result', async () => {
    const doc = await upload('personal-loan-fixed');
    const truth = await sampleTruth('personal-loan-fixed');
    ctx.llm.setHandler(fakeExtraction);
    const res = await request(ctx.app).post(`/api/documents/${doc.documentId}/extract`).expect(200);
    const { terms, cost } = res.body;
    expect(terms.principal.amount).toBe(truth.terms.principal.amount);
    expect(terms.principal.citation.page).toBeGreaterThanOrEqual(1);
    expect(truth.terms.principal.pages).toContain(terms.principal.citation.page);
    expect(terms.prepaymentCharges.percent).toBe(4);
    expect(terms.prepaymentCharges.citation.clauseTitle).toMatch(/PREPAYMENT/);
    expect(terms.interestRate.notFound).toBe(false);
    expect(cost.cost.emi).toBe(truth.computed.emi);
    expect(cost.cost.netDisbursal).toBe(truth.computed.netDisbursal);
    expect(cost.upfrontBreakdown.map((b: { label: string }) => b.label)).toEqual(['Processing fee', 'Insurance premium', 'GST on processing fee']);
    expect(cost.cost.aprPercent).toBeGreaterThan(14);

    const summary = await request(ctx.app).get(`/api/documents/${doc.documentId}`).expect(200);
    expect(summary.body.extraction.principal.amount).toBe(500000);
    expect(summary.body.cost.cost.effectiveAnnualRatePercent).toBe(cost.cost.effectiveAnnualRatePercent);

    await request(ctx.app).post(`/api/documents/${doc.documentId}/extract`).expect(200);
    expect(ctx.llm.generateCalls).toHaveLength(1);
    await request(ctx.app).post(`/api/documents/${doc.documentId}/extract?force=1`).expect(200);
    expect(ctx.llm.generateCalls).toHaveLength(2);
    expect(ctx.llm.generateCalls[0]!.responseSchema).toBeDefined();
  });

  it('retries once on invalid output and salvages what it can on the second failure', async () => {
    const doc = await upload('home-loan-floating');
    ctx.llm.setHandler((req, i) => {
      if (i === 0) return textResponse('{"lenderName": "not an object"');
      expect((req.messages.at(-1)!.parts[0] as { text: string }).text).toMatch(/failed validation/);
      return jsonResponse({ lenderName: { value: 'Sunrise Housing Finance Corporation Limited', ref: 1, confidence: 1 }, principalAmount: 'oops' });
    });
    const res = await request(ctx.app).post(`/api/documents/${doc.documentId}/extract`).expect(200);
    expect(ctx.llm.generateCalls).toHaveLength(2);
    expect(res.body.terms.lenderName.value).toBe('Sunrise Housing Finance Corporation Limited');
    expect(res.body.terms.principal.notFound).toBe(true);
    expect(res.body.cost.cost).toBeNull();
    expect(res.body.cost.missing).toEqual(['principal', 'interest rate', 'tenure']);
  });
});

describe('POST /api/documents/:id/risks', () => {
  it('sends only pre-filtered candidates to the model and keeps confirmed flags with citations', async () => {
    const doc = await upload('personal-loan-fixed');
    const truth = await sampleTruth('personal-loan-fixed');
    let candidateCount = 0;
    ctx.llm.setHandler((req) => {
      const text = (req.messages[0]!.parts[0] as { text: string }).text;
      candidateCount = (text.match(/^Candidate \d+ \|/gm) ?? []).length;
      const reviews = Array.from({ length: candidateCount }, (_, i) => {
        const header = text.split(/^Candidate /m)[i + 1]!;
        const risk = /risk: ([^|]+) \|/.exec(header)![1]!.trim();
        const present = /Auto-debit|Penal interest|arbitration|data-sharing/i.test(risk) && !/protect/i.test(header);
        return { candidate: i + 1, present, severity: 'high', title: `${risk} clause`, explanation: 'Plain-English reason for the borrower. Two sentences.' };
      });
      return jsonResponse({ reviews });
    });
    const res = await request(ctx.app).post(`/api/documents/${doc.documentId}/risks`).expect(200);
    expect(candidateCount).toBeGreaterThan(3);
    expect(candidateCount).toBeLessThanOrEqual(16);
    const categories = res.body.riskFlags.map((f: { category: string }) => f.category);
    for (const r of truth.risks) expect(categories).toContain(r.category);
    expect(new Set(categories).size).toBe(categories.length);
    for (const f of res.body.riskFlags) {
      expect(f.citation.page).toBeGreaterThanOrEqual(1);
      expect(f.explanation.length).toBeGreaterThan(20);
    }
    const summary = await request(ctx.app).get(`/api/documents/${doc.documentId}`).expect(200);
    expect(summary.body.riskFlags).toHaveLength(res.body.riskFlags.length);
    await request(ctx.app).post(`/api/documents/${doc.documentId}/risks`).expect(200);
    expect(ctx.llm.generateCalls).toHaveLength(1);
  });

  it('rejects malformed reviews with a 502', async () => {
    const doc = await upload('vehicle-loan-flat');
    ctx.llm.setHandler(() => jsonResponse({ reviews: [{ candidate: 'one' }] }));
    const res = await request(ctx.app).post(`/api/documents/${doc.documentId}/risks`).expect(502);
    expect(res.body.error.code).toBe('LLM_BAD_RESPONSE');
  });
});

describe('POST /api/compare', () => {
  it('extracts both sides, computes costs and returns the narrative', async () => {
    const left = await upload('personal-loan-fixed');
    const right = await upload('business-loan-kfs');
    ctx.llm.setHandler((req) => {
      if (req.responseSchema && /Extract the loan terms/.test((req.messages[0]!.parts[0] as { text: string }).text)) return fakeExtraction(req);
      const payload = (req.messages[0]!.parts[0] as { text: string }).text;
      expect(payload).toContain('"offerA"');
      expect(payload).toContain('effectiveAnnualRatePercent');
      return jsonResponse({
        summary: 'Both offers carry the same terms in this test, so neither is cheaper.',
        differences: [{ aspect: 'Processing fee', left: '2%', right: '2%', favours: 'neither', note: 'Identical.' }],
      });
    });
    const res = await request(ctx.app).post('/api/compare').send({ leftId: left.documentId, rightId: right.documentId }).expect(200);
    expect(res.body.left.documentId).toBe(left.documentId);
    expect(res.body.right.terms.principal.amount).toBe(500000);
    expect(res.body.left.cost.cost.emi).toBe(17088.81);
    expect(res.body.cheaper).toBe('unknown');
    expect(res.body.differences).toHaveLength(1);
    expect(ctx.llm.generateCalls).toHaveLength(3);

    await request(ctx.app).post('/api/compare').send({ leftId: left.documentId, rightId: left.documentId }).expect(400);
    await request(ctx.app).post('/api/compare').send({ leftId: left.documentId, rightId: '00000000-0000-0000-0000-000000000000' }).expect(404);
    await request(ctx.app).post('/api/compare').send({ leftId: 'x' }).expect(400);
  });
});
