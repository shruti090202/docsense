import { Router } from 'express';
import type { Config } from '../config.js';
import type { Db } from '../db/pool.js';

// Liveness only: never touches the database, so uptime pings do not keep Neon's compute awake.
export function healthRouter(deps: { config: Config; db: Db; version: string }): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: deps.version,
      models: {
        chat: deps.config.GEMINI_CHAT_MODEL,
        extraction: deps.config.GEMINI_EXTRACTION_MODEL,
        embedding: deps.config.GEMINI_EMBEDDING_MODEL,
      },
      uptimeSec: Math.round(process.uptime()),
    });
  });

  router.get('/health/db', async (_req, res) => {
    try {
      await deps.db.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch (err) {
      res.status(503).json({ status: 'error', message: (err as Error).message });
    }
  });

  return router;
}
