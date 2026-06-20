// Provider-neutral shapes. Parts mirror Gemini's content model closely enough that the tool-calling
// loop can echo model parts (including thought signatures) back verbatim.

export interface TextPart {
  text: string;
  thoughtSignature?: string;
}

export interface FunctionCallPart {
  functionCall: { name: string; args: Record<string, unknown>; id?: string };
  thoughtSignature?: string;
}

export interface FunctionResponsePart {
  functionResponse: { name: string; response: Record<string, unknown>; id?: string };
}

export type Part = TextPart | FunctionCallPart | FunctionResponsePart;

export interface Message {
  role: 'user' | 'model';
  parts: Part[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  // JSON Schema for the arguments object
  parameters: Record<string, unknown>;
}

export interface GenerateRequest {
  system: string;
  messages: Message[];
  tools?: ToolDefinition[];
  // JSON Schema; when set the model must answer with a JSON object matching it
  responseSchema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
  // which model to use; the client falls back to its default
  model?: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateResponse {
  text: string | null;
  functionCalls: FunctionCallPart['functionCall'][];
  // model parts exactly as returned, for appending to the conversation
  parts: Part[];
  usage: Usage;
  model: string;
}

export type EmbeddingTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

export interface LlmClient {
  readonly chatModel: string;
  readonly embeddingModel: string;
  readonly embeddingDimensions: number;
  generate(req: GenerateRequest): Promise<GenerateResponse>;
  embed(texts: string[], taskType: EmbeddingTaskType): Promise<number[][]>;
}

export class LlmError extends Error {
  constructor(
    readonly code: 'RATE_LIMITED' | 'UNAVAILABLE' | 'BAD_RESPONSE' | 'NOT_CONFIGURED' | 'UPSTREAM',
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}
