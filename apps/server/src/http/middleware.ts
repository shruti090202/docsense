import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { IngestError } from '../ingest/types.js';
import type { Logger } from '../logger.js';
import { HttpError } from './errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
  }
}

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && incoming.length <= 64 ? incoming : randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
};

export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(new HttpError(400, 'VALIDATION_ERROR', 'Invalid request body', result.error.issues));
      return;
    }
    req.body = result.data;
    next();
  };
}

// Multer and body-parser surface their own error shapes; normalise everything to { error: {...} }.
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const requestId = req.requestId;
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, requestId, details: err.details } });
      return;
    }
    if (err instanceof IngestError) {
      res.status(422).json({ error: { code: err.code, message: err.message, requestId } });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', requestId, details: err.issues } });
      return;
    }
    const anyErr = err as { code?: string; type?: string; status?: number; message?: string };
    if (anyErr.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'File exceeds the upload size limit', requestId } });
      return;
    }
    if (anyErr.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large', requestId } });
      return;
    }
    if (anyErr.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Malformed JSON body', requestId } });
      return;
    }
    logger.error({ err, requestId }, 'unhandled error');
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong', requestId } });
  };
}
