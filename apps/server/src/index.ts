import { createRequire } from 'node:module';
import * as Sentry from '@sentry/node';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { createLogger } from './logger.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV === 'development');

if (config.SENTRY_DSN) {
  Sentry.init({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV, release: `docsense-server@${version}` });
}

const db = createPool(config.DATABASE_URL);
const app = createApp({ config, db, logger, version });
if (config.SENTRY_DSN) Sentry.setupExpressErrorHandler(app);

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, models: { chat: config.GEMINI_CHAT_MODEL } }, 'server listening');
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    await db.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
