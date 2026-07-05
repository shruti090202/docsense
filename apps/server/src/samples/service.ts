import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { SampleInfo, UploadResponse } from '@docsense/shared';
import type { DocumentRepository, DocumentRow } from '../db/documents.js';
import { notFound } from '../http/errors.js';
import { ingest } from '../ingest/pipeline.js';
import type { Logger } from '../logger.js';
import type { EmbeddingService } from '../retrieval/embeddings.js';

interface SampleIndexEntry {
  slug: string;
  title: string;
  kind: 'loan' | 'contract' | 'general';
  file: string;
  pageCount: number;
}

// Sample agreements live in the repo, so a wiped database (cleanup, fresh Neon branch) re-ingests
// them on demand; the embedding cache means that costs no Gemini calls once warmed.
export class SampleService {
  private index: SampleIndexEntry[] | null = null;

  constructor(
    private readonly samplesDir: string,
    private readonly documents: DocumentRepository,
    private readonly embeddings: EmbeddingService,
    private readonly logger: Logger,
  ) {}

  private async loadIndex(): Promise<SampleIndexEntry[]> {
    if (!this.index) {
      this.index = JSON.parse(await readFile(path.join(this.samplesDir, 'index.json'), 'utf8')) as SampleIndexEntry[];
    }
    return this.index;
  }

  async list(): Promise<SampleInfo[]> {
    const entries = await this.loadIndex();
    const out: SampleInfo[] = [];
    for (const e of entries) {
      const row = await this.documents.findBySampleSlug(e.slug);
      out.push({ slug: e.slug, title: e.title, kind: e.kind, pageCount: e.pageCount, loaded: row?.status === 'embedded' });
    }
    return out;
  }

  async load(slug: string): Promise<UploadResponse> {
    const entry = (await this.loadIndex()).find((e) => e.slug === slug);
    if (!entry) throw notFound('Unknown sample');
    let row: DocumentRow | null = await this.documents.findBySampleSlug(slug);
    let piiMap: UploadResponse['piiMap'] = {};
    let warnings: string[] = [];
    if (!row) {
      const buffer = await readFile(path.join(this.samplesDir, entry.file));
      const result = await ingest({ buffer, mimeType: 'application/pdf', fileName: `${slug}.pdf` }, { maxPages: 60 });
      row = await this.documents.createWithChunks(
        {
          title: entry.title,
          sourceType: 'pdf',
          kind: result.kind,
          contentHash: result.contentHash,
          pageCount: result.pageCount,
          ttlHours: 24 * 365 * 10,
          isSample: true,
          sampleSlug: slug,
        },
        result.chunks,
      );
      piiMap = result.piiMap;
      warnings = result.warnings;
      this.logger.info({ slug, documentId: row.id, chunks: result.chunks.length }, 'sample ingested');
    } else {
      // the map is not stored; rebuild it from the repo file so the demo can unmask like a real upload
      const buffer = await readFile(path.join(this.samplesDir, entry.file));
      const result = await ingest({ buffer, mimeType: 'application/pdf', fileName: `${slug}.pdf` }, { maxPages: 60 });
      piiMap = result.piiMap;
    }
    if (row.status !== 'embedded') await this.embeddings.embedDocument(row.id);
    const fresh = (await this.documents.findById(row.id))!;
    return {
      documentId: fresh.id,
      title: fresh.title,
      sourceType: fresh.source_type,
      kind: fresh.kind,
      pageCount: fresh.page_count,
      chunkCount: fresh.chunk_count,
      status: fresh.status,
      piiMap,
      warnings,
    };
  }
}
