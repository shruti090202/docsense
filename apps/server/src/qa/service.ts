import { createHash } from 'node:crypto';
import type { AskResponse, ChatTurn, PiiMap, ToolCallRecord } from '@docsense/shared';
import type { Config } from '../config.js';
import type { DocumentRepository, DocumentRow } from '../db/documents.js';
import type { Db } from '../db/pool.js';
import { HttpError, notFound } from '../http/errors.js';
import type { LlmClient, Message } from '../llm/types.js';
import type { Logger } from '../logger.js';
import { PiiMasker } from '../privacy/pii.js';
import type { EmbeddingService } from '../retrieval/embeddings.js';
import type { HybridSearch, RetrievedChunk } from '../retrieval/search.js';
import { parseAnswer } from './citations.js';
import { QA_SYSTEM_PROMPT, formatContext, formatQuestion } from './prompt.js';
import { TOOL_DEFINITIONS, executeTool } from './tools.js';

const MAX_TOOL_ROUNDS = 4;

export interface AskInput {
  documentId: string;
  question: string;
  history: ChatTurn[];
  // upload-time placeholder map, so identifiers typed into a question get the same placeholder
  piiMap?: PiiMap;
}

export interface QaDeps {
  db: Db;
  config: Config;
  llm: LlmClient;
  documents: DocumentRepository;
  embeddings: EmbeddingService;
  search: HybridSearch;
  logger: Logger;
}

function normaliseQuestion(q: string): string {
  return q.toLowerCase().replace(/[^\p{L}\p{N}\s\[\]_]/gu, ' ').replace(/\s+/g, ' ').trim();
}

export class QaService {
  constructor(private readonly deps: QaDeps) {}

  // Documents parsed while the embedding API was unavailable are embedded lazily on first use.
  async ensureEmbedded(doc: DocumentRow): Promise<void> {
    if (doc.status === 'embedded') return;
    await this.deps.embeddings.embedDocument(doc.id);
  }

  async retrieve(documentId: string, question: string): Promise<RetrievedChunk[]> {
    const { config } = this.deps;
    return this.deps.search.search(documentId, question, {
      topK: config.RETRIEVAL_TOP_K,
      vectorWeight: config.RETRIEVAL_VECTOR_WEIGHT,
      textWeight: config.RETRIEVAL_TEXT_WEIGHT,
    });
  }

  // Function-calling loop: the model requests calculator tools, the server runs them deterministically,
  // and the model gets the results back until it produces a final text answer.
  private async runWithTools(messages: Message[]): Promise<{ text: string | null; toolCalls: ToolCallRecord[]; usage: { inputTokens: number; outputTokens: number } }> {
    const { llm, logger } = this.deps;
    const toolCalls: ToolCallRecord[] = [];
    const usage = { inputTokens: 0, outputTokens: 0 };
    const conversation = [...messages];
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const res = await llm.generate({ system: QA_SYSTEM_PROMPT, messages: conversation, tools: TOOL_DEFINITIONS, temperature: 0.1 });
      usage.inputTokens += res.usage.inputTokens;
      usage.outputTokens += res.usage.outputTokens;
      if (res.functionCalls.length === 0) return { text: res.text, toolCalls, usage };
      conversation.push({ role: 'model', parts: res.parts });
      const responses = res.functionCalls.map((call) => {
        const result = executeTool(call.name, call.args);
        toolCalls.push({ name: call.name, args: call.args, result });
        logger.info({ tool: call.name, args: call.args, result }, 'tool executed');
        return { functionResponse: { name: call.name, response: result, ...(call.id ? { id: call.id } : {}) } };
      });
      conversation.push({ role: 'user', parts: responses });
    }
    throw new HttpError(502, 'LLM_TOOL_LOOP', 'The model kept requesting calculations without answering');
  }

  async ask(input: AskInput): Promise<AskResponse> {
    const { db, config, llm, documents, logger } = this.deps;
    const doc = await documents.findById(input.documentId);
    if (!doc) throw notFound('Document not found or expired');
    await this.ensureEmbedded(doc);

    const masker = new PiiMasker(input.piiMap);
    const question = masker.mask(input.question).text;
    const history = input.history.map((t) => ({ role: t.role, content: masker.mask(t.content).text }));

    // Follow-up questions depend on the conversation, so only standalone questions are cached.
    const cacheKey =
      history.length === 0
        ? createHash('sha256').update(`${doc.id}|${llm.chatModel}|${normaliseQuestion(question)}`).digest('hex')
        : null;
    if (cacheKey) {
      const hit = await db.query<{ response: AskResponse }>('SELECT response FROM qa_cache WHERE cache_key = $1', [cacheKey]);
      if (hit.rows[0]) return { ...hit.rows[0].response, cached: true };
    }

    const chunks = await this.retrieve(doc.id, question);
    if (chunks.length === 0) {
      return { answer: 'The document does not appear to contain anything related to this question.', citations: [], toolCalls: [], grounded: true, cached: false };
    }

    const messages: Message[] = [
      ...history.map<Message>((t) => ({ role: t.role === 'user' ? 'user' : 'model', parts: [{ text: t.content }] })),
      { role: 'user', parts: [{ text: formatQuestion(formatContext(chunks), question) }] },
    ];
    const started = Date.now();
    const { text, toolCalls, usage } = await this.runWithTools(messages);
    if (!text) throw new HttpError(502, 'LLM_EMPTY', 'The model returned no answer');
    const parsed = parseAnswer(text, chunks);
    const response: AskResponse = {
      answer: parsed.answer,
      citations: parsed.citations,
      toolCalls,
      // an answer built on tool output is grounded even when it cites no passage explicitly
      grounded: parsed.grounded || (toolCalls.length > 0 && !parsed.notFound),
      cached: false,
    };
    logger.info(
      { documentId: doc.id, ms: Date.now() - started, retrieved: chunks.length, citations: parsed.citations.length, toolCalls: toolCalls.length, notFound: parsed.notFound, usage },
      'question answered',
    );
    if (cacheKey) {
      await db.query('INSERT INTO qa_cache (cache_key, document_id, response) VALUES ($1, $2, $3) ON CONFLICT (cache_key) DO NOTHING', [
        cacheKey,
        doc.id,
        JSON.stringify(response),
      ]);
    }
    return response;
  }
}
