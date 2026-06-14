import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import type { Config } from '../config.js';
import type { DocumentRepository } from '../db/documents.js';
import { unauthorized } from '../http/errors.js';
import type { Logger } from '../logger.js';

function tokenMatches(header: string | undefined, expected: string | undefined): boolean {
  if (!header || !expected) return false;
  const presented = header.replace(/^Bearer\s+/i, '');
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Called by the scheduled GitHub Actions workflow; Render free has no cron of its own.
export function internalRouter(deps: { config: Config; documents: DocumentRepository; logger: Logger }): Router {
  const router = Router();

  router.post('/cleanup', async (req, res, next) => {
    try {
      if (!tokenMatches(req.header('authorization'), deps.config.CLEANUP_TOKEN)) throw unauthorized();
      const deleted = await deps.documents.deleteExpired();
      deps.logger.info({ deleted }, 'expired documents removed');
      res.json({ deleted });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
