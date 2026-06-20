import { createHash } from 'node:crypto';
import type { Db } from '../db/pool.js';
import { toVectorLiteral } from '../db/pool.js';
import type { EmbeddingTaskType, LlmClient } from '../llm/types.js';
import type { Logger } from '../logger.js';

export interface EmbeddingStats {
  requested: number;
  cacheHits: number;
  apiCalls: number;
}

export function embeddingCacheKey(model: string, dims: number, taskType: EmbeddingTaskType, text: string): string {
  return createHash('sha256').update(`${model}:${dims}:${taskType}:${text}`).digest('hex');
}

function parseVector(value: string | number[]): number[] {
  return Array.isArray(value) ? value : (JSON.parse(value) as number[]);
}

// Content-addressed cache in front of the embedding API. Identical chunks (re-uploads, sample
// documents, CI fixtures) never cost a second API call.
export class EmbeddingService {
  // ~32 chunks x 400 tokens stays well under the free tier's 30K tokens/minute
  private readonly batchSize = 32;

  constructor(
    private readonly db: Db,
    private readonly llm: LlmClient,
    private readonly logger: Logger,
  ) {}

  async embedTexts(texts: string[], taskType: EmbeddingTaskType): Promise<{ vectors: number[][]; stats: EmbeddingStats }> {
    const stats: EmbeddingStats = { requested: texts.length, cacheHits: 0, apiCalls: 0 };
    if (texts.length === 0) return { vectors: [], stats };
    const keys = texts.map((t) => embeddingCacheKey(this.llm.embeddingModel, this.llm.embeddingDimensions, taskType, t));
    const cached = await this.db.query<{ content_hash: string; embedding: string }>(
      'SELECT content_hash, embedding::text AS embedding FROM embedding_cache WHERE content_hash = ANY($1)',
      [keys],
    );
    const byKey = new Map(cached.rows.map((r) => [r.content_hash, parseVector(r.embedding)]));
    stats.cacheHits = byKey.size;

    const uniqueMissing = new Map<string, number>();
    keys.forEach((k, i) => {
      if (!byKey.has(k) && !uniqueMissing.has(k)) uniqueMissing.set(k, i);
    });
    const pending = [...uniqueMissing.entries()];

    for (let start = 0; start < pending.length; start += this.batchSize) {
      const batch = pending.slice(start, start + this.batchSize);
      const vectors = await this.llm.embed(batch.map(([, i]) => texts[i]!), taskType);
      stats.apiCalls += 1;
      const values: unknown[] = [];
      const tuples = batch.map(([key], j) => {
        values.push(key, this.llm.embeddingModel, toVectorLiteral(vectors[j]!));
        byKey.set(key, vectors[j]!);
        return `($${j * 3 + 1}, $${j * 3 + 2}, $${j * 3 + 3}::vector)`;
      });
      await this.db.query(
        `INSERT INTO embedding_cache (content_hash, model, embedding) VALUES ${tuples.join(', ')} ON CONFLICT (content_hash) DO NOTHING`,
        values,
      );
    }
    return { vectors: keys.map((k) => byKey.get(k)!), stats };
  }

  // Idempotent and resumable: only chunks without a vector are embedded, so a 429 halfway through
  // a document leaves it in 'parsed' and a later call finishes the job.
  async embedDocument(documentId: string): Promise<EmbeddingStats> {
    const { rows } = await this.db.query<{ id: string; content: string }>(
      'SELECT id, content FROM chunks WHERE document_id = $1 AND embedding IS NULL ORDER BY chunk_index',
      [documentId],
    );
    const { vectors, stats } = await this.embedTexts(rows.map((r) => r.content), 'RETRIEVAL_DOCUMENT');
    if (rows.length) {
      const ids = rows.map((r) => r.id);
      const literals = vectors.map(toVectorLiteral);
      await this.db.query(
        `UPDATE chunks AS c SET embedding = v.embedding::vector
         FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::text[]) AS embedding) AS v
         WHERE c.id = v.id`,
        [ids, literals],
      );
    }
    await this.db.query("UPDATE documents SET status = 'embedded' WHERE id = $1", [documentId]);
    this.logger.info({ documentId, ...stats }, 'document embedded');
    return stats;
  }

  async embedQuery(text: string): Promise<number[]> {
    const { vectors } = await this.embedTexts([text], 'RETRIEVAL_QUERY');
    return vectors[0]!;
  }
}
