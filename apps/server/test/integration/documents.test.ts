import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
});

describe('health', () => {
  it('reports model ids without touching secrets', async () => {
    const res = await request(ctx.app).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.models.embedding).toBe(ctx.config.GEMINI_EMBEDDING_MODEL);
    expect(JSON.stringify(res.body)).not.toContain('API_KEY');
  });

  it('pings the database on /health/db', async () => {
    await request(ctx.app).get('/health/db').expect(200, { status: 'ok' });
  });
});

describe('POST /api/documents', () => {
  it('ingests a PDF, stores masked chunks and returns the PII map', async () => {
    const truth = await sampleTruth('personal-loan-fixed');
    const res = await request(ctx.app)
      .post('/api/documents')
      .attach('file', await samplePdf('personal-loan-fixed'), 'personal-loan-fixed.pdf')
      .expect(201);

    expect(res.body.pageCount).toBe(truth.pageCount);
    expect(res.body.status).toBe('parsed');
    expect(res.body.chunkCount).toBeGreaterThan(8);
    expect(Object.values(res.body.piiMap)).toContain(truth.pii.pan);
    expect(res.headers['x-request-id']).toBeTruthy();

    const stored = await ctx.db.query<{ content: string; page_start: number; clause_title: string | null; tsv: string }>(
      'SELECT content, page_start, clause_title, tsv::text AS tsv FROM chunks WHERE document_id = $1 ORDER BY chunk_index',
      [res.body.documentId],
    );
    expect(stored.rows).toHaveLength(res.body.chunkCount);
    const all = stored.rows.map((r) => r.content).join('\n');
    expect(all).not.toContain(truth.pii.pan);
    expect(all).not.toContain(truth.pii.aadhaar);
    expect(all).toContain('[PAN_1]');
    expect(stored.rows.some((r) => r.clause_title?.includes('PREPAYMENT'))).toBe(true);
    expect(stored.rows[0]!.tsv).toContain('loan');
  });

  it('exposes the document summary and individual chunks', async () => {
    const up = await request(ctx.app)
      .post('/api/documents')
      .attach('file', await samplePdf('vehicle-loan-flat'), 'vehicle-loan-flat.pdf')
      .expect(201);
    const doc = await request(ctx.app).get(`/api/documents/${up.body.documentId}`).expect(200);
    expect(doc.body).toMatchObject({ id: up.body.documentId, sourceType: 'pdf', isSample: false, extraction: null });
    expect(new Date(doc.body.expiresAt).getTime() - new Date(doc.body.createdAt).getTime()).toBeCloseTo(24 * 3600 * 1000, -4);

    const { rows } = await ctx.db.query<{ id: string }>('SELECT id FROM chunks WHERE document_id = $1 LIMIT 1', [up.body.documentId]);
    const chunk = await request(ctx.app).get(`/api/documents/${up.body.documentId}/chunks/${rows[0]!.id}`).expect(200);
    expect(chunk.body.content.length).toBeGreaterThan(20);
    expect(chunk.body.pageStart).toBeGreaterThanOrEqual(1);
  });

  it('rejects an image-only PDF with 422 and a helpful message', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    doc.addPage();
    const res = await request(ctx.app)
      .post('/api/documents')
      .attach('file', Buffer.from(await doc.save()), 'scan.pdf')
      .expect(422);
    expect(res.body.error.code).toBe('SCANNED_PDF');
    expect(res.body.error.message).toMatch(/scanned or image-only/);
  });

  it('rejects unsupported types and missing files', async () => {
    const bad = await request(ctx.app).post('/api/documents').attach('file', Buffer.from('hello'), 'notes.txt').expect(422);
    expect(bad.body.error.code).toBe('UNSUPPORTED_TYPE');
    const missing = await request(ctx.app).post('/api/documents').expect(400);
    expect(missing.body.error.code).toBe('MISSING_FILE');
  });

  it('enforces the upload size limit', async () => {
    const small = await createTestContext({ MAX_UPLOAD_MB: 0.005 });
    try {
      const res = await request(small.app)
        .post('/api/documents')
        .attach('file', await samplePdf('home-loan-floating'), 'home-loan-floating.pdf')
        .expect(413);
      expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    } finally {
      await small.close();
    }
  });

  it('deletes a document and its chunks', async () => {
    const up = await request(ctx.app)
      .post('/api/documents')
      .attach('file', await samplePdf('education-loan-floating'), 'education-loan-floating.pdf')
      .expect(201);
    await request(ctx.app).delete(`/api/documents/${up.body.documentId}`).expect(204);
    await request(ctx.app).get(`/api/documents/${up.body.documentId}`).expect(404);
    const { rowCount } = await ctx.db.query('SELECT 1 FROM chunks WHERE document_id = $1', [up.body.documentId]);
    expect(rowCount).toBe(0);
  });

  it('validates ids', async () => {
    const res = await request(ctx.app).get('/api/documents/not-a-uuid').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /internal/cleanup', () => {
  it('requires the bearer token', async () => {
    await request(ctx.app).post('/internal/cleanup').expect(401);
    await request(ctx.app).post('/internal/cleanup').set('authorization', 'Bearer wrong').expect(401);
  });

  it('removes expired non-sample documents only', async () => {
    const up = await request(ctx.app)
      .post('/api/documents')
      .attach('file', await samplePdf('business-loan-kfs'), 'business-loan-kfs.pdf')
      .expect(201);
    await ctx.db.query("UPDATE documents SET expires_at = now() - interval '1 minute' WHERE id = $1", [up.body.documentId]);
    await ctx.db.query(
      `INSERT INTO documents (title, source_type, content_hash, page_count, is_sample, sample_slug, expires_at)
       VALUES ('sample', 'pdf', 'x', 1, true, 'demo', now() - interval '1 day')`,
    );
    const res = await request(ctx.app).post('/internal/cleanup').set('authorization', 'Bearer test-cleanup-token').expect(200);
    expect(res.body.deleted).toBe(1);
    const { rows } = await ctx.db.query<{ sample_slug: string | null }>('SELECT sample_slug FROM documents');
    expect(rows).toEqual([{ sample_slug: 'demo' }]);
  });
});
