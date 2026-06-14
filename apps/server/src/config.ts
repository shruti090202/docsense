import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_CHAT_MODEL: z.string().default('gemini-3.5-flash-lite'),
  GEMINI_EXTRACTION_MODEL: z.string().default('gemini-3.8-flash'),
  GEMINI_EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(768),

  MAX_UPLOAD_MB: z.coerce.number().positive().default(10),
  MAX_PAGES: z.coerce.number().int().positive().default(60),

  RETRIEVAL_TOP_K: z.coerce.number().int().positive().default(8),
  RETRIEVAL_VECTOR_WEIGHT: z.coerce.number().nonnegative().default(1),
  RETRIEVAL_TEXT_WEIGHT: z.coerce.number().nonnegative().default(1),

  RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_LLM_MAX: z.coerce.number().int().positive().default(10),

  CLEANUP_TOKEN: z.string().optional(),
  DOCUMENT_TTL_HOURS: z.coerce.number().positive().default(24),

  SENTRY_DSN: z.string().optional(),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
}
