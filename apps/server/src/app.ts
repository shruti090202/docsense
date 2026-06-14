import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Config } from './config.js';
import { DocumentRepository } from './db/documents.js';
import type { Db } from './db/pool.js';
import { errorHandler, requestId } from './http/middleware.js';
import type { Logger } from './logger.js';
import { documentsRouter } from './routes/documents.js';
import { healthRouter } from './routes/health.js';
import { internalRouter } from './routes/internal.js';

export interface AppDeps {
  config: Config;
  db: Db;
  logger: Logger;
  version?: string;
}

export function createApp(deps: AppDeps): Express {
  const { config, db, logger } = deps;
  const documents = new DocumentRepository(db);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(requestId);
  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGIN.split(',').map((o) => o.trim()), exposedHeaders: ['x-request-id'] }));
  app.use(express.json({ limit: '256kb' }));
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.requestId,
      autoLogging: { ignore: (req) => req.url === '/health' },
      customSuccessMessage: () => 'request completed',
      serializers: { req: (req) => ({ id: req.id, method: req.method, url: req.url }) },
    }),
  );

  const apiLimiter = rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_SEC * 1000,
    limit: config.RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down' } },
  });

  app.use(healthRouter({ config, db, version: deps.version ?? 'dev' }));
  app.use('/api', apiLimiter);
  app.use('/api/documents', documentsRouter({ config, documents, logger }));
  app.use('/internal', internalRouter({ config, documents, logger }));

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });
  app.use(errorHandler(logger));
  return app;
}
