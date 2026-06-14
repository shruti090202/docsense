import type { DocumentStatus, LoanTerms, RiskFlag, SourceType } from '@docsense/shared';
import type { Chunk } from '../ingest/types.js';
import type { Db } from './pool.js';

export interface DocumentRow {
  id: string;
  title: string;
  source_type: SourceType;
  content_hash: string;
  page_count: number;
  chunk_count: number;
  is_sample: boolean;
  sample_slug: string | null;
  status: DocumentStatus;
  extraction: LoanTerms | null;
  risk_flags: RiskFlag[] | null;
  created_at: Date;
  expires_at: Date;
}

export interface ChunkRow {
  id: string;
  document_id: string;
  chunk_index: number;
  page_start: number;
  page_end: number;
  clause_title: string | null;
  content: string;
  token_count: number;
}

export interface NewDocument {
  title: string;
  sourceType: SourceType;
  contentHash: string;
  pageCount: number;
  ttlHours: number;
  isSample?: boolean;
  sampleSlug?: string;
}

export class DocumentRepository {
  constructor(private readonly db: Db) {}

  async createWithChunks(doc: NewDocument, chunks: Chunk[]): Promise<DocumentRow> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<DocumentRow>(
        `INSERT INTO documents (title, source_type, content_hash, page_count, chunk_count, is_sample, sample_slug, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() + ($8 || ' hours')::interval)
         RETURNING *`,
        [
          doc.title,
          doc.sourceType,
          doc.contentHash,
          doc.pageCount,
          chunks.length,
          doc.isSample ?? false,
          doc.sampleSlug ?? null,
          String(doc.ttlHours),
        ],
      );
      const row = inserted.rows[0]!;
      if (chunks.length) {
        const values: unknown[] = [];
        const tuples = chunks.map((c, i) => {
          const base = i * 7;
          values.push(row.id, c.index, c.pageStart, c.pageEnd, c.clauseTitle, c.content, c.tokenCount);
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
        });
        await client.query(
          `INSERT INTO chunks (document_id, chunk_index, page_start, page_end, clause_title, content, token_count)
           VALUES ${tuples.join(', ')}`,
          values,
        );
      }
      await client.query('COMMIT');
      return row;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async findById(id: string): Promise<DocumentRow | null> {
    const res = await this.db.query<DocumentRow>('SELECT * FROM documents WHERE id = $1', [id]);
    return res.rows[0] ?? null;
  }

  async findBySampleSlug(slug: string): Promise<DocumentRow | null> {
    const res = await this.db.query<DocumentRow>('SELECT * FROM documents WHERE sample_slug = $1', [slug]);
    return res.rows[0] ?? null;
  }

  async listChunks(documentId: string): Promise<ChunkRow[]> {
    const res = await this.db.query<ChunkRow>(
      `SELECT id, document_id, chunk_index, page_start, page_end, clause_title, content, token_count
       FROM chunks WHERE document_id = $1 ORDER BY chunk_index`,
      [documentId],
    );
    return res.rows;
  }

  async findChunk(documentId: string, chunkId: string): Promise<ChunkRow | null> {
    const res = await this.db.query<ChunkRow>(
      `SELECT id, document_id, chunk_index, page_start, page_end, clause_title, content, token_count
       FROM chunks WHERE document_id = $1 AND id = $2`,
      [documentId, chunkId],
    );
    return res.rows[0] ?? null;
  }

  async setStatus(id: string, status: DocumentStatus): Promise<void> {
    await this.db.query('UPDATE documents SET status = $2 WHERE id = $1', [id, status]);
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db.query('DELETE FROM documents WHERE id = $1 AND NOT is_sample', [id]);
    return (res.rowCount ?? 0) > 0;
  }

  async deleteExpired(): Promise<number> {
    const res = await this.db.query('DELETE FROM documents WHERE expires_at < now() AND NOT is_sample');
    return res.rowCount ?? 0;
  }
}
