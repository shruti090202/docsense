import { Router } from 'express';
import { z } from 'zod';
import type { SampleService } from '../samples/service.js';

const SlugParam = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,64}$/) });

export function samplesRouter(deps: { samples: SampleService }): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      res.json(await deps.samples.list());
    } catch (err) {
      next(err);
    }
  });

  router.post('/:slug/load', async (req, res, next) => {
    try {
      const { slug } = SlugParam.parse(req.params);
      res.json(await deps.samples.load(slug));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
