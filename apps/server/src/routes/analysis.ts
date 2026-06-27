import { Router } from 'express';
import { z } from 'zod';
import { CompareRequestSchema, costFromTerms } from '@docsense/shared';
import type { CompareService } from '../compare/service.js';
import type { DocumentRepository } from '../db/documents.js';
import { ExtractionService, ForceQuery } from '../extraction/service.js';
import { notFound } from '../http/errors.js';
import { validateBody } from '../http/middleware.js';
import type { QaService } from '../qa/service.js';
import type { RiskService } from '../risks/service.js';

const IdParam = z.object({ id: z.string().uuid() });

export function analysisRouter(deps: {
  documents: DocumentRepository;
  qa: QaService;
  extraction: ExtractionService;
  risks: RiskService;
  compare: CompareService;
}): Router {
  const router = Router();

  router.post('/documents/:id/extract', async (req, res, next) => {
    try {
      const { id } = IdParam.parse(req.params);
      const { force } = ForceQuery.parse(req.query);
      const doc = await deps.documents.findById(id);
      if (!doc) throw notFound('Document not found or expired');
      await deps.qa.ensureEmbedded(doc);
      const terms = await deps.extraction.extract(doc, { force: force !== undefined });
      res.json({ terms, cost: costFromTerms(terms) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/documents/:id/risks', async (req, res, next) => {
    try {
      const { id } = IdParam.parse(req.params);
      const { force } = ForceQuery.parse(req.query);
      const doc = await deps.documents.findById(id);
      if (!doc) throw notFound('Document not found or expired');
      const riskFlags = await deps.risks.detect(doc, { force: force !== undefined });
      res.json({ riskFlags });
    } catch (err) {
      next(err);
    }
  });

  router.post('/compare', validateBody(CompareRequestSchema), async (req, res, next) => {
    try {
      const { leftId, rightId } = req.body as z.infer<typeof CompareRequestSchema>;
      res.json(await deps.compare.compare(leftId, rightId));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
