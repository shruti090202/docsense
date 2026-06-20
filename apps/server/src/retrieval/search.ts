import type { ChunkRow } from '../db/documents.js';
import { toVectorLiteral, type Db } from '../db/pool.js';
import type { EmbeddingService } from './embeddings.js';
import { reciprocalRankFusion, type RankedList } from './rrf.js';

export interface SearchOptions {
  topK: number;
  vectorWeight: number;
  textWeight: number;
  // how many candidates each retriever contributes before fusion
  candidateK?: number;
}

export interface RetrievedChunk extends ChunkRow {
  score: number;
  ranks: Record<string, number>;
}

const CHUNK_COLUMNS = 'id, document_id, chunk_index, page_start, page_end, clause_title, content, token_count';

export class HybridSearch {
  constructor(
    private readonly db: Db,
    private readonly embeddings: EmbeddingService,
  ) {}

  async vectorSearch(documentId: string, queryVector: number[], k: number): Promise<ChunkRow[]> {
    const { rows } = await this.db.query<ChunkRow>(
      `SELECT ${CHUNK_COLUMNS} FROM chunks
       WHERE document_id = $1 AND embedding IS NOT NULL
       ORDER BY embedding <=> $2::vector
       LIMIT $3`,
      [documentId, toVectorLiteral(queryVector), k],
    );
    return rows;
  }

  async textSearch(documentId: string, query: string, k: number): Promise<ChunkRow[]> {
    // websearch_to_tsquery tolerates free-form questions; an all-stopword query yields no lexemes
    const { rows } = await this.db.query<ChunkRow>(
      `WITH q AS (SELECT websearch_to_tsquery('english', $2) AS query)
       SELECT ${CHUNK_COLUMNS} FROM chunks, q
       WHERE document_id = $1 AND numnode(q.query) > 0 AND tsv @@ q.query
       ORDER BY ts_rank_cd(tsv, q.query) DESC, chunk_index
       LIMIT $3`,
      [documentId, query, k],
    );
    return rows;
  }

  async search(documentId: string, query: string, opts: SearchOptions): Promise<RetrievedChunk[]> {
    const candidateK = opts.candidateK ?? Math.max(opts.topK * 3, 20);
    const [vector, text] = await Promise.all([
      opts.vectorWeight > 0
        ? this.embeddings.embedQuery(query).then((v) => this.vectorSearch(documentId, v, candidateK))
        : Promise.resolve([] as ChunkRow[]),
      opts.textWeight > 0 ? this.textSearch(documentId, query, candidateK) : Promise.resolve([] as ChunkRow[]),
    ]);
    const byId = new Map<string, ChunkRow>();
    for (const row of [...vector, ...text]) byId.set(row.id, row);
    const lists: RankedList[] = [
      { ids: vector.map((r) => r.id), weight: opts.vectorWeight, source: 'vector' },
      { ids: text.map((r) => r.id), weight: opts.textWeight, source: 'text' },
    ];
    return reciprocalRankFusion(lists)
      .slice(0, opts.topK)
      .map((f) => ({ ...byId.get(f.id)!, score: f.score, ranks: f.ranks }));
  }
}
