import pg from 'pg';

export type Db = pg.Pool;

// Neon free tier autosuspends after 5 minutes; a small pool with short idle timeout avoids
// holding connections that only keep the compute awake.
export function createPool(connectionString: string): Db {
  const ssl = /neon\.tech|sslmode=require/.test(connectionString) ? { rejectUnauthorized: true } : undefined;
  return new pg.Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
    ...(ssl ? { ssl } : {}),
  });
}

export function toVectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`;
}
