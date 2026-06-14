import type { SourceType } from '@docsense/shared';

export interface ParsedPage {
  page: number;
  text: string;
}

export interface ParsedDocument {
  sourceType: SourceType;
  pageCount: number;
  pages: ParsedPage[];
  warnings: string[];
}

export interface Chunk {
  index: number;
  clauseTitle: string | null;
  content: string;
  pageStart: number;
  pageEnd: number;
  tokenCount: number;
}

export class IngestError extends Error {
  constructor(
    readonly code: 'SCANNED_PDF' | 'EMPTY_DOCUMENT' | 'TOO_MANY_PAGES' | 'UNSUPPORTED_TYPE' | 'PARSE_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'IngestError';
  }
}
