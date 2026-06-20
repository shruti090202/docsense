import { Router } from 'express';
import { z } from 'zod';
import { AskRequestSchema } from '@docsense/shared';
import type { DocumentRepository } from '../db/documents.js';
import { notFound } from '../http/errors.js';
import { validateBody } from '../http/middleware.js';
import type { QaService } from '../qa/service.js';
import type { EmbeddingService } from '../retrieval/embeddings.js';

const IdParam = z.object({ id: z.string().uuid() });

export function qaRouter(deps: { qa: QaService; documents: DocumentRepository; embeddings: EmbeddingService }): Router {
  const router = Router();

  router.post('/:id/ask', validateBody(AskRequestSchema), async (req, res, next) => {
    try {
      const { id } = IdParam.parse(req.params);
      const body = req.body as z.infer<typeof AskRequestSchema>;
      const result = await deps.qa.ask({
        documentId: id,
        question: body.question,
        history: body.history,
        ...(body.piiMap ? { piiMap: body.piiMap } : {}),
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // Resume embedding for a document whose upload hit the embedding quota.
  router.post('/:id/embed', async (req, res, next) => {
    try {
      const { id } = IdParam.parse(req.params);
      const doc = await deps.documents.findById(id);
      if (!doc) throw notFound('Document not found or expired');
      const stats = doc.status === 'embedded' ? { requested: 0, cacheHits: 0, apiCalls: 0 } : await deps.embeddings.embedDocument(id);
      res.json({ status: 'embedded', ...stats });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
