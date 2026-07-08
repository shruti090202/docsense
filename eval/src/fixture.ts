import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, toVectorLiteral, type Db } from '@docsense/server/db/pool';

// The embedding cache for the sample corpus and golden queries, committed so CI and repeat runs
// never spend embedding quota. Vectors are rounded to 6 decimals (cosine ranking is unaffected).
const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/embeddings.json');

interface Row {
  content_hash: string;
  model: string;
  embedding: number[];
}

export async function exportFixture(db: Db): Promise<number> {
  const { rows } = await db.query<{ content_hash: string; model: string; embedding: string }>('SELECT content_hash, model, embedding::text AS embedding FROM embedding_cache ORDER BY content_hash');
  const out: Row[] = rows.map((r) => ({ content_hash: r.content_hash, model: r.model, embedding: (JSON.parse(r.embedding) as number[]).map((x) => Math.round(x * 1e6) / 1e6) }));
  await writeFile(FIXTURE, JSON.stringify(out) + '\n');
  return out.length;
}

export async function importFixture(db: Db): Promise<number> {
  let rows: Row[];
  try {
    rows = JSON.parse(await readFile(FIXTURE, 'utf8')) as Row[];
  } catch {
    return 0;
  }
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const values: unknown[] = [];
    const tuples = batch.map((r, j) => {
      values.push(r.content_hash, r.model, toVectorLiteral(r.embedding));
      return `($${j * 3 + 1}, $${j * 3 + 2}, $${j * 3 + 3}::vector)`;
    });
    await db.query(`INSERT INTO embedding_cache (content_hash, model, embedding) VALUES ${tuples.join(', ')} ON CONFLICT (content_hash) DO NOTHING`, values);
  }
  return rows.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const db = createPool(process.env['DATABASE_URL'] ?? 'postgres://docsense:docsense@localhost:5432/docsense');
  const mode = process.argv[2];
  const n = mode === 'export' ? await exportFixture(db) : await importFixture(db);
  console.log(`${mode}: ${n} embeddings`);
  await db.end();
}
