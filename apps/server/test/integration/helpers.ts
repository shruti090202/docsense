import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import { loadConfig, type Config } from '../../src/config.js';
import { createPool, type Db } from '../../src/db/pool.js';
import { createLogger } from '../../src/logger.js';

export const samplesDir = path.resolve(import.meta.dirname, '../../../../samples');
export const samplePdf = (slug: string) => readFile(path.join(samplesDir, 'pdf', `${slug}.pdf`));
export const sampleTruth = async (slug: string) =>
  JSON.parse(await readFile(path.join(samplesDir, 'ground-truth', `${slug}.json`), 'utf8'));

export interface TestContext {
  app: Express;
  db: Db;
  config: Config;
  close: () => Promise<void>;
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  const base = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://docsense:docsense@localhost:5432/docsense',
    CLEANUP_TOKEN: 'test-cleanup-token',
    RATE_LIMIT_MAX: '1000',
    RATE_LIMIT_LLM_MAX: '1000',
  });
  return { ...base, ...overrides };
}

export async function createTestContext(overrides: Partial<Config> = {}): Promise<TestContext> {
  const config = testConfig(overrides);
  const db = createPool(config.DATABASE_URL);
  const logger = createLogger('silent');
  const app = createApp({ config, db, logger, version: 'test' });
  return { app, db, config, close: () => db.end() };
}

export async function truncateAll(db: Db): Promise<void> {
  await db.query('TRUNCATE documents CASCADE');
  await db.query('TRUNCATE embedding_cache');
}
