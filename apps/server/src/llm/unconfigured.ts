import { LlmError, type LlmClient } from './types.js';

// Stands in when GEMINI_API_KEY is absent so the rest of the API (upload, health) still works.
export class UnconfiguredLlmClient implements LlmClient {
  readonly chatModel = 'unconfigured';
  readonly embeddingModel = 'unconfigured';
  readonly embeddingDimensions = 768;

  async generate(): Promise<never> {
    throw new LlmError('NOT_CONFIGURED', 'GEMINI_API_KEY is not set on the server');
  }

  async embed(): Promise<never> {
    throw new LlmError('NOT_CONFIGURED', 'GEMINI_API_KEY is not set on the server');
  }
}
