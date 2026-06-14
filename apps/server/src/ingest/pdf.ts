import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem } from 'pdfjs-dist/types/src/display/api.js';
import { IngestError, type ParsedDocument, type ParsedPage } from './types.js';

export interface PdfParseOptions {
  maxPages: number;
  // pages with fewer visible characters than this are treated as image-only
  minCharsPerPage?: number;
}

interface PositionedItem {
  x: number;
  y: number;
  str: string;
}

// pdf.js returns positioned text runs, not lines; rebuild lines by grouping runs on the same baseline.
export function itemsToText(items: PositionedItem[]): string {
  const lines: { y: number; items: PositionedItem[] }[] = [];
  const tolerance = 2.5;
  for (const item of items) {
    if (!item.str.trim()) continue;
    const line = lines.find((l) => Math.abs(l.y - item.y) <= tolerance);
    if (line) line.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  }
  lines.sort((a, b) => b.y - a.y);
  return lines
    .map((l) =>
      l.items
        .sort((a, b) => a.x - b.x)
        .map((i) => i.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .join('\n');
}

export async function parsePdf(buffer: Buffer, opts: PdfParseOptions): Promise<ParsedDocument> {
  const minChars = opts.minCharsPerPage ?? 25;
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const task = getDocument({
    data,
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  });
  const doc = await task.promise.catch((err: unknown) => {
    throw new IngestError('PARSE_FAILED', `Could not open PDF: ${(err as Error).message}`);
  });
  try {
    if (doc.numPages > opts.maxPages) {
      throw new IngestError('TOO_MANY_PAGES', `PDF has ${doc.numPages} pages; the limit is ${opts.maxPages}`);
    }
    const pages: ParsedPage[] = [];
    let textPages = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const items = content.items
        .filter((it): it is TextItem => 'str' in it)
        .map((it) => ({ x: it.transform[4] as number, y: it.transform[5] as number, str: it.str }));
      const text = itemsToText(items);
      if (text.replace(/\s/g, '').length >= minChars) textPages += 1;
      pages.push({ page: i, text });
      page.cleanup();
    }
    const warnings: string[] = [];
    if (doc.numPages === 0 || textPages === 0) {
      throw new IngestError(
        'SCANNED_PDF',
        'This PDF has no extractable text. It looks scanned or image-only; please upload a text-based PDF or DOCX.',
      );
    }
    if (textPages < doc.numPages) {
      warnings.push(`${doc.numPages - textPages} of ${doc.numPages} pages had no extractable text and were skipped.`);
    }
    return { sourceType: 'pdf', pageCount: doc.numPages, pages, warnings };
  } finally {
    await doc.destroy();
  }
}
