import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { textResponse } from '../../src/llm/fake.js';
import { LlmError } from '../../src/llm/types.js';
import { EmbeddingService } from '../../src/retrieval/embeddings.js';
import { HybridSearch } from '../../src/retrieval/search.js';
import { createLogger } from '../../src/logger.js';
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
  ctx.llm.embedCalls.length = 0;
  ctx.llm.setHandler(() => textResponse('fake answer'));
});

async function upload(slug: string) {
  const res = await request(ctx.app).post('/api/documents').attach('file', await samplePdf(slug), `${slug}.pdf`).expect(201);
  return res.body as { documentId: string; chunkCount: number; status: string; piiMap: Record<string, string> };
}

describe('embedding on upload', () => {
  it('embeds every chunk in one batched call and marks the document embedded', async () => {
    const doc = await upload('personal-loan-fixed');
    expect(doc.status).toBe('embedded');
    expect(ctx.llm.embedCalls).toHaveLength(1);
    expect(ctx.llm.embedCalls[0]!.texts).toHaveLength(doc.chunkCount);
    expect(ctx.llm.embedCalls[0]!.taskType).toBe('RETRIEVAL_DOCUMENT');
    const { rows } = await ctx.db.query<{ n: string }>('SELECT count(*)::text AS n FROM chunks WHERE document_id = $1 AND embedding IS NULL', [doc.documentId]);
    expect(rows[0]!.n).toBe('0');
  });

  it('serves a re-upload of the same document entirely from the embedding cache', async () => {
    await upload('home-loan-floating');
    await upload('home-loan-floating');
    expect(ctx.llm.embedCalls).toHaveLength(1);
    const { rows } = await ctx.db.query<{ n: string }>("SELECT count(*)::text AS n FROM documents WHERE status = 'embedded'");
    expect(rows[0]!.n).toBe('2');
  });

  it('keeps the parsed document when the embedding API is rate limited, then resumes', async () => {
    const original = ctx.llm.embed.bind(ctx.llm);
    ctx.llm.embed = async () => {
      throw new LlmError('RATE_LIMITED', 'quota', 3000);
    };
    const res = await request(ctx.app).post('/api/documents').attach('file', await samplePdf('vehicle-loan-flat'), 'v.pdf').expect(201);
    expect(res.body.status).toBe('parsed');
    expect(res.body.warnings.join(' ')).toMatch(/Embeddings could not be generated/);

    ctx.llm.embed = original;
    const resumed = await request(ctx.app).post(`/api/documents/${res.body.documentId}/embed`).expect(200);
    expect(resumed.body.status).toBe('embedded');
    expect(resumed.body.requested).toBe(res.body.chunkCount);
    const doc = await request(ctx.app).get(`/api/documents/${res.body.documentId}`).expect(200);
    expect(doc.body.status).toBe('embedded');
  });
});

describe('hybrid retrieval', () => {
  it('finds the prepayment clause for a paraphrased question and the exact clause for a keyword query', async () => {
    const doc = await upload('personal-loan-fixed');
    const truth = await sampleTruth('personal-loan-fixed');
    const embeddings = new EmbeddingService(ctx.db, ctx.llm, createLogger('silent'));
    const search = new HybridSearch(ctx.db, embeddings);
    const opts = { topK: 5, vectorWeight: 1, textWeight: 1 };

    const prepay = await search.search(doc.documentId, 'Can I foreclose the loan early and what does prepayment cost?', opts);
    expect(prepay.length).toBeGreaterThan(0);
    expect(prepay.some((c) => truth.terms.prepaymentCharges.pages.includes(c.page_start))).toBe(true);
    expect(prepay.some((c) => /prepayment/i.test(c.clause_title ?? ''))).toBe(true);

    const bounce = await search.search(doc.documentId, 'bounce charges', opts);
    expect(bounce[0]!.content.toLowerCase()).toContain('bounce');
    expect(bounce.slice(0, 3).some((c) => c.content.toLowerCase().includes('dishonour'))).toBe(true);
    expect(Object.keys(bounce[0]!.ranks)).toEqual(expect.arrayContaining(['text']));
  });

  it('falls back to vector-only when the query has no full-text lexemes', async () => {
    const doc = await upload('education-loan-floating');
    const embeddings = new EmbeddingService(ctx.db, ctx.llm, createLogger('silent'));
    const search = new HybridSearch(ctx.db, embeddings);
    const results = await search.search(doc.documentId, 'the of and', { topK: 3, vectorWeight: 1, textWeight: 1 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.ranks['text'] === undefined)).toBe(true);
  });
});

describe('POST /api/documents/:id/ask', () => {
  it('sends masked, numbered context to the model and returns resolved citations', async () => {
    const doc = await upload('personal-loan-fixed');
    const truth = await sampleTruth('personal-loan-fixed');
    ctx.llm.setHandler((req) => {
      const prompt = req.messages.at(-1)!.parts[0] as { text: string };
      expect(prompt.text).toContain('[1] (page');
      expect(prompt.text).not.toContain(truth.pii.pan);
      expect(req.system).toMatch(/Answer ONLY from the numbered context/);
      return textResponse('Prepayment costs 4% of the outstanding principal [1]. It is not allowed in the first 12 EMIs [1].');
    });
    const res = await request(ctx.app)
      .post(`/api/documents/${doc.documentId}/ask`)
      .send({ question: 'What are the prepayment charges?' })
      .expect(200);
    expect(res.body.grounded).toBe(true);
    expect(res.body.cached).toBe(false);
    expect(res.body.citations).toHaveLength(1);
    expect(res.body.citations[0]).toMatchObject({ ref: 1, page: expect.any(Number), quote: expect.any(String) });
    expect(res.body.citations[0].chunkId).toMatch(/^[0-9a-f-]{36}$/);
    const chunk = await request(ctx.app).get(`/api/documents/${doc.documentId}/chunks/${res.body.citations[0].chunkId}`).expect(200);
    expect(chunk.body.pageStart).toBe(res.body.citations[0].page);
  });

  it('masks identifiers typed into the question using the upload map', async () => {
    const doc = await upload('personal-loan-fixed');
    const truth = await sampleTruth('personal-loan-fixed');
    let seen = '';
    ctx.llm.setHandler((req) => {
      seen = (req.messages.at(-1)!.parts[0] as { text: string }).text;
      return textResponse('Yes, [PAN_1] is the borrower [1].');
    });
    await request(ctx.app)
      .post(`/api/documents/${doc.documentId}/ask`)
      .send({ question: `Is ${truth.pii.pan} the borrower's PAN?`, piiMap: doc.piiMap })
      .expect(200);
    expect(seen).not.toContain(truth.pii.pan);
    expect(seen).toContain('[PAN_1]');
  });

  it('returns not-found answers with no citations when the model declines', async () => {
    const doc = await upload('home-loan-floating');
    ctx.llm.setHandler(() => textResponse('NOT_IN_DOCUMENT\nThe agreement does not mention a cooling-off period.'));
    const res = await request(ctx.app).post(`/api/documents/${doc.documentId}/ask`).send({ question: 'Is there a cooling-off period?' }).expect(200);
    expect(res.body.answer).toBe('The agreement does not mention a cooling-off period.');
    expect(res.body.citations).toEqual([]);
    expect(res.body.grounded).toBe(true);
  });

  it('flags answers that cite nothing as ungrounded', async () => {
    const doc = await upload('home-loan-floating');
    ctx.llm.setHandler(() => textResponse('Home loans in India usually charge nothing for prepayment.'));
    const res = await request(ctx.app).post(`/api/documents/${doc.documentId}/ask`).send({ question: 'prepayment?' }).expect(200);
    expect(res.body.grounded).toBe(false);
  });

  it('caches standalone questions but not follow-ups', async () => {
    const doc = await upload('business-loan-kfs');
    ctx.llm.setHandler(() => textResponse('The processing fee is 2.5% [1].'));
    const q = { question: 'What is the processing fee?' };
    const first = await request(ctx.app).post(`/api/documents/${doc.documentId}/ask`).send(q).expect(200);
    const second = await request(ctx.app).post(`/api/documents/${doc.documentId}/ask`).send({ question: 'what is the PROCESSING fee??' }).expect(200);
    expect(first.body.cached).toBe(false);
    expect(second.body.cached).toBe(true);
    expect(second.body.answer).toBe(first.body.answer);
    expect(ctx.llm.generateCalls).toHaveLength(1);

    await request(ctx.app)
      .post(`/api/documents/${doc.documentId}/ask`)
      .send({ question: 'And is it refundable?', history: [{ role: 'user', content: q.question }, { role: 'assistant', content: first.body.answer }] })
      .expect(200);
    expect(ctx.llm.generateCalls).toHaveLength(2);
    expect(ctx.llm.generateCalls[1]!.messages).toHaveLength(3);
    expect(ctx.llm.generateCalls[1]!.messages[1]!.role).toBe('model');
  });

  it('embeds lazily when a document is still in parsed state', async () => {
    const doc = await upload('education-loan-floating');
    await ctx.db.query("UPDATE documents SET status = 'parsed' WHERE id = $1", [doc.documentId]);
    await ctx.db.query('UPDATE chunks SET embedding = NULL WHERE document_id = $1', [doc.documentId]);
    ctx.llm.setHandler(() => textResponse('EMI is stated [1].'));
    await request(ctx.app).post(`/api/documents/${doc.documentId}/ask`).send({ question: 'What is the EMI?' }).expect(200);
    const row = await request(ctx.app).get(`/api/documents/${doc.documentId}`).expect(200);
    expect(row.body.status).toBe('embedded');
  });

  it('validates the body and surfaces LLM quota errors as 429 with retry-after', async () => {
    const doc = await upload('vehicle-loan-flat');
    const bad = await request(ctx.app).post(`/api/documents/${doc.documentId}/ask`).send({ question: '' }).expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');

    ctx.llm.setHandler(() => {
      throw new LlmError('RATE_LIMITED', 'quota', 12_000);
    });
    const limited = await request(ctx.app).post(`/api/documents/${doc.documentId}/ask`).send({ question: 'anything?' }).expect(429);
    expect(limited.body.error.code).toBe('LLM_RATE_LIMITED');
    expect(limited.headers['retry-after']).toBe('12');
    await request(ctx.app).post('/api/documents/00000000-0000-0000-0000-000000000000/ask').send({ question: 'x?' }).expect(404);
  });
});

describe('samples', () => {
  it('lists samples, loads one on demand and serves it as an embedded document', async () => {
    const list = await request(ctx.app).get('/api/samples').expect(200);
    expect(list.body.length).toBe(7);
    expect(list.body.map((s: { kind: string }) => s.kind)).toEqual(['loan', 'loan', 'loan', 'loan', 'loan', 'contract', 'general']);
    expect(list.body[0]).toMatchObject({ slug: 'personal-loan-fixed', loaded: false, pageCount: expect.any(Number) });

    const loaded = await request(ctx.app).post('/api/samples/personal-loan-fixed/load').expect(200);
    expect(loaded.body.status).toBe('embedded');
    expect(Object.keys(loaded.body.piiMap)).toContain('[PAN_1]');

    const again = await request(ctx.app).post('/api/samples/personal-loan-fixed/load').expect(200);
    expect(again.body.documentId).toBe(loaded.body.documentId);
    expect(ctx.llm.embedCalls).toHaveLength(1);

    const after = await request(ctx.app).get('/api/samples').expect(200);
    expect(after.body.find((s: { slug: string }) => s.slug === 'personal-loan-fixed').loaded).toBe(true);
    const doc = await request(ctx.app).get(`/api/documents/${loaded.body.documentId}`).expect(200);
    expect(doc.body.isSample).toBe(true);
    await request(ctx.app).delete(`/api/documents/${loaded.body.documentId}`).expect(404);
    await request(ctx.app).post('/api/samples/nope/load').expect(404);
  });
});
