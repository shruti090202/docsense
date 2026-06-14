import mammoth from 'mammoth';
import { IngestError, type ParsedDocument } from './types.js';

// DOCX has no fixed pagination, so the whole document is reported as page 1 and
// citations rely on clause titles instead of page numbers.
export async function parseDocx(buffer: Buffer): Promise<ParsedDocument> {
  const result = await mammoth.extractRawText({ buffer }).catch((err: unknown) => {
    throw new IngestError('PARSE_FAILED', `Could not open DOCX: ${(err as Error).message}`);
  });
  const text = result.value.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.replace(/\s/g, '').length < 25) {
    throw new IngestError('EMPTY_DOCUMENT', 'This DOCX contains no readable text.');
  }
  const warnings = result.messages.filter((m) => m.type === 'warning').map((m) => m.message);
  return { sourceType: 'docx', pageCount: 1, pages: [{ page: 1, text }], warnings };
}
