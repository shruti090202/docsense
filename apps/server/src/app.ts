import path from 'node:path';
import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Config } from './config.js';
import { DocumentRepository } from './db/documents.js';
import type { Db } from './db/pool.js';
import { errorHandler, requestId } from './http/middleware.js';
import { GeminiClient } from './llm/gemini.js';
import type { LlmClient } from './llm/types.js';
import { UnconfiguredLlmClient } from './llm/unconfigured.js';
import type { Logger } from './logger.js';
import { QaService } from './qa/service.js';
import { EmbeddingService } from './retrieval/embeddings.js';
import { HybridSearch } from './retrieval/search.js';
import { documentsRouter } from './routes/documents.js';
import { healthRouter } from './routes/health.js';
import { internalRouter } from './routes/internal.js';
import { qaRouter } from './routes/qa.js';
import { samplesRouter } from './routes/samples.js';
import { SampleService } from './samples/service.js';

export interface AppDeps {
  config: Config;
  db: Db;
  logger: Logger;
  version?: string;
  // tests inject a fake; production builds a Gemini client from config
  llm?: LlmClient;
}

export function createLlmClient(config: Config, logger: Logger): LlmClient {
  if (!config.GEMINI_API_KEY) {
    logger.warn('GEMINI_API_KEY not set; LLM features disabled');
    return new UnconfiguredLlmClient();
  }
  return new GeminiClient({
    apiKey: config.GEMINI_API_KEY,
    chatModel: config.GEMINI_CHAT_MODEL,
    embeddingModel: config.GEMINI_EMBEDDING_MODEL,
    embeddingDimensions: config.EMBEDDING_DIMENSIONS,
    chatRpm: config.GEMINI_CHAT_RPM,
    embedRpm: config.GEMINI_EMBED_RPM,
    logger,
  });
}

export function createApp(deps: AppDeps): Express {
  const { config, db, logger } = deps;
  const llm = deps.llm ?? createLlmClient(config, logger);
  const documents = new DocumentRepository(db);
  const embeddings = new EmbeddingService(db, llm, logger);
  const search = new HybridSearch(db, embeddings);
  const qa = new QaService({ db, config, llm, documents, embeddings, search, logger });
  const samplesDir = config.SAMPLES_DIR ?? path.resolve(import.meta.dirname, '../../../samples');
  const samples = new SampleService(samplesDir, documents, embeddings, logger);

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

  const limiter = (limit: number) =>
    rateLimit({
      windowMs: config.RATE_LIMIT_WINDOW_SEC * 1000,
      limit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down' } },
    });
  // LLM-backed routes get a tighter per-IP budget; the Gemini free tier is shared by every visitor
  const llmLimiter = limiter(config.RATE_LIMIT_LLM_MAX);

  app.use(healthRouter({ config, db, version: deps.version ?? 'dev' }));
  app.use('/api', limiter(config.RATE_LIMIT_MAX));
  app.use('/api/documents/:id/ask', llmLimiter);
  app.use('/api/documents', documentsRouter({ config, documents, embeddings, logger }));
  app.use('/api/documents', qaRouter({ qa, documents, embeddings }));
  app.use('/api/samples', samplesRouter({ samples }));
  app.use('/internal', internalRouter({ config, documents, logger }));

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });
  app.use(errorHandler(logger));
  return app;
}
