import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { parseDocx } from '../../src/ingest/docx.js';
import { itemsToText, parsePdf } from '../../src/ingest/pdf.js';
import { ingest, maskAndChunk } from '../../src/ingest/pipeline.js';
import { IngestError } from '../../src/ingest/types.js';

const samples = path.resolve(import.meta.dirname, '../../../../samples');
const truth = async (slug: string) => JSON.parse(await readFile(path.join(samples, 'ground-truth', `${slug}.json`), 'utf8'));
const pdf = (slug: string) => readFile(path.join(samples, 'pdf', `${slug}.pdf`));

describe('parsePdf', () => {
  it('extracts every page with the right page number', async () => {
    const t = await truth('personal-loan-fixed');
    const parsed = await parsePdf(await pdf('personal-loan-fixed'), { maxPages: 60 });
    expect(parsed.sourceType).toBe('pdf');
    expect(parsed.pageCount).toBe(t.pageCount);
    expect(parsed.pages.map((p) => p.page)).toEqual(Array.from({ length: t.pageCount }, (_, i) => i + 1));
    expect(parsed.warnings).toEqual([]);
  });

  it('places facts on the pages the generator recorded', async () => {
    for (const slug of ['personal-loan-fixed', 'home-loan-floating', 'vehicle-loan-flat', 'business-loan-kfs', 'education-loan-floating']) {
      const t = await truth(slug);
      const parsed = await parsePdf(await pdf(slug), { maxPages: 60 });
      const byPage = new Map(parsed.pages.map((p) => [p.page, p.text]));
      const principalPages: number[] = t.terms.principal.pages;
      expect(principalPages.length).toBeGreaterThan(0);
      for (const page of principalPages) expect(byPage.get(page)).toMatch(/Rs\. \d/);
      const emiPages: number[] = t.terms.statedEmi.pages;
      const emiText = String(t.terms.statedEmi.amount).split('.')[0]!.slice(-3);
      expect(emiPages.some((p) => byPage.get(p)?.includes(emiText))).toBe(true);
    }
  });

  it('reconstructs reading order from positioned text runs', () => {
    const text = itemsToText([
      { x: 300, y: 700, str: 'World' },
      { x: 100, y: 700, str: 'Hello' },
      { x: 100, y: 680, str: 'Second line' },
      { x: 100, y: 701.5, str: '' },
    ]);
    expect(text).toBe('Hello World\nSecond line');
  });

  it('rejects an image-only PDF with a clear message', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([400, 400]);
    doc.addPage([400, 400]);
    const bytes = Buffer.from(await doc.save());
    await expect(parsePdf(bytes, { maxPages: 60 })).rejects.toMatchObject({ code: 'SCANNED_PDF' });
  });

  it('warns about individual blank pages but still parses the rest', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([400, 400]).drawText('This first page has a full sentence of text in it for parsing.', { x: 20, y: 200, size: 10, font });
    doc.addPage([400, 400]);
    const parsed = await parsePdf(Buffer.from(await doc.save()), { maxPages: 60 });
    expect(parsed.pageCount).toBe(2);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]).toMatch(/1 of 2 pages/);
  });

  it('enforces the page limit', async () => {
    await expect(parsePdf(await pdf('home-loan-floating'), { maxPages: 2 })).rejects.toMatchObject({ code: 'TOO_MANY_PAGES' });
  });

  it('rejects garbage bytes', async () => {
    await expect(parsePdf(Buffer.from('not a pdf'), { maxPages: 60 })).rejects.toBeInstanceOf(IngestError);
  });
});

describe('parseDocx', () => {
  it('extracts text as a single page', async () => {
    const parsed = await parseDocx(await readFile(path.join(samples, 'docx', 'personal-loan-fixed.docx')));
    expect(parsed.sourceType).toBe('docx');
    expect(parsed.pageCount).toBe(1);
    expect(parsed.pages[0]!.text).toContain('PERSONAL LOAN AGREEMENT');
    expect(parsed.pages[0]!.text).toContain('Rs. 5,00,000');
  });

  it('rejects non-docx bytes', async () => {
    await expect(parseDocx(Buffer.from('nope'))).rejects.toMatchObject({ code: 'PARSE_FAILED' });
  });
});

describe('ingest pipeline', () => {
  it('masks every borrower identifier before chunking and returns the map', async () => {
    const t = await truth('personal-loan-fixed');
    const result = await ingest(
      { buffer: await pdf('personal-loan-fixed'), mimeType: 'application/pdf', fileName: 'personal-loan-fixed.pdf' },
      { maxPages: 60 },
    );
    expect(result.title).toBe('personal loan fixed');
    expect(result.chunks.length).toBeGreaterThan(8);
    const all = result.chunks.map((c) => c.content).join('\n');
    const pii = t.pii as Record<string, string>;
    for (const key of ['pan', 'aadhaar', 'email', 'account', 'ifsc'] as const) expect(all).not.toContain(pii[key]);
    expect(all).not.toContain(pii.phone!.replace(/\D/g, '').slice(-5));
    expect(Object.values(result.piiMap)).toEqual(expect.arrayContaining([pii.pan, pii.aadhaar, pii.email, pii.ifsc]));
    expect(result.piiCounts.PAN).toBeGreaterThanOrEqual(2);
    expect(result.piiCounts.AADHAAR).toBe(1);
    expect(all).toContain('[PAN_1]');
  });

  it('rejects unsupported file types', async () => {
    await expect(
      ingest({ buffer: Buffer.from('x'), mimeType: 'text/plain', fileName: 'notes.txt' }, { maxPages: 60 }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' });
  });

  it('produces a stable content hash for identical masked text', () => {
    const doc = (text: string) => ({ sourceType: 'pdf' as const, pageCount: 1, pages: [{ page: 1, text }], warnings: [] });
    const a = maskAndChunk(doc('1. LOAN\nPAN AKLPM4821R borrows Rs. 1,00,000.'));
    const b = maskAndChunk(doc('1. LOAN\nPAN BQRPI7734K borrows Rs. 1,00,000.'));
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.piiMap).toEqual({ '[PAN_1]': 'AKLPM4821R' });
  });
});
