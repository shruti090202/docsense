import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { costFromTerms, type DocumentSummary, type UploadResponse } from '@docsense/shared';
import type { Config } from '../config.js';
import type { DocumentRepository, DocumentRow } from '../db/documents.js';
import { badRequest, notFound } from '../http/errors.js';
import { ingest } from '../ingest/pipeline.js';
import { IngestError } from '../ingest/types.js';
import { LlmError } from '../llm/types.js';
import type { Logger } from '../logger.js';
import type { EmbeddingService } from '../retrieval/embeddings.js';

const IdParam = z.object({ id: z.string().uuid() });
const ChunkParams = z.object({ id: z.string().uuid(), chunkId: z.string().uuid() });

export function toSummary(row: DocumentRow): DocumentSummary {
  return {
    id: row.id,
    title: row.title,
    sourceType: row.source_type,
    kind: row.kind,
    pageCount: row.page_count,
    chunkCount: row.chunk_count,
    status: row.status,
    isSample: row.is_sample,
    extraction: row.extraction,
    contractFacts: row.contract_facts,
    outline: row.outline,
    riskFlags: row.risk_flags,
    cost: row.extraction ? costFromTerms(row.extraction) : null,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  };
}

export function documentsRouter(deps: {
  config: Config;
  documents: DocumentRepository;
  embeddings: EmbeddingService;
  logger: Logger;
}): Router {
  const { config, documents, embeddings, logger } = deps;
  const router = Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: Math.floor(config.MAX_UPLOAD_MB * 1024 * 1024), files: 1 },
    fileFilter: (_req, file, cb) => {
      const ok =
        file.mimetype === 'application/pdf' ||
        file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        /\.(pdf|docx)$/i.test(file.originalname);
      if (ok) cb(null, true);
      else cb(new IngestError('UNSUPPORTED_TYPE', 'Only PDF and DOCX files are supported'));
    },
  });

  router.post('/', upload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) throw badRequest('MISSING_FILE', 'Attach a PDF or DOCX as the "file" field');
      const started = Date.now();
      const result = await ingest(
        { buffer: req.file.buffer, mimeType: req.file.mimetype, fileName: req.file.originalname },
        { maxPages: config.MAX_PAGES },
      );
      let row = await documents.createWithChunks(
        {
          title: result.title,
          sourceType: result.sourceType,
          kind: result.kind,
          contentHash: result.contentHash,
          pageCount: result.pageCount,
          ttlHours: config.DOCUMENT_TTL_HOURS,
        },
        result.chunks,
      );
      // Embedding is best-effort here: a quota error leaves the document 'parsed' and /ask retries later.
      const warnings = [...result.warnings];
      try {
        await embeddings.embedDocument(row.id);
        row = (await documents.findById(row.id)) ?? row;
      } catch (err) {
        if (!(err instanceof LlmError)) throw err;
        logger.warn({ documentId: row.id, code: err.code, err: err.message }, 'embedding deferred');
        warnings.push('Embeddings could not be generated right now; questions will retry automatically.');
      }
      logger.info(
        {
          requestId: req.requestId,
          documentId: row.id,
          pages: result.pageCount,
          chunks: result.chunks.length,
          kind: result.kind,
          pii: result.piiCounts,
          status: row.status,
          ms: Date.now() - started,
        },
        'document ingested',
      );
      const body: UploadResponse = {
        documentId: row.id,
        title: row.title,
        sourceType: row.source_type,
        kind: row.kind,
        pageCount: row.page_count,
        chunkCount: row.chunk_count,
        status: row.status,
        piiMap: result.piiMap,
        warnings,
      };
      res.status(201).json(body);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const { id } = IdParam.parse(req.params);
      const row = await documents.findById(id);
      if (!row) throw notFound('Document not found or expired');
      res.json(toSummary(row));
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/chunks/:chunkId', async (req, res, next) => {
    try {
      const { id, chunkId } = ChunkParams.parse(req.params);
      const chunk = await documents.findChunk(id, chunkId);
      if (!chunk) throw notFound('Chunk not found');
      res.json({
        id: chunk.id,
        index: chunk.chunk_index,
        pageStart: chunk.page_start,
        pageEnd: chunk.page_end,
        clauseTitle: chunk.clause_title,
        content: chunk.content,
      });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const { id } = IdParam.parse(req.params);
      const deleted = await documents.delete(id);
      if (!deleted) throw notFound('Document not found or expired');
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
