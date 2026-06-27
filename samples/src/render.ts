import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export type Block =
  | { kind: 'title'; text: string }
  | { kind: 'heading'; text: string; tag?: string }
  | { kind: 'para'; text: string; tag?: string }
  | { kind: 'kv'; key: string; value: string; tag?: string }
  | { kind: 'spacer' };

export interface RenderResult {
  bytes: Uint8Array;
  pageCount: number;
  // tag -> page numbers on which the tagged block was drawn (a block may span two pages)
  tagPages: Record<string, number[]>;
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;
const BODY = 10.5;
const LINE = 15;

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function renderPdf(blocks: Block[], meta: { title: string; author: string }): Promise<RenderResult> {
  const doc = await PDFDocument.create();
  doc.setTitle(meta.title);
  doc.setAuthor(meta.author);
  doc.setProducer('DocSense sample generator');
  // fixed dates keep the committed PDFs byte-for-byte reproducible
  doc.setCreationDate(new Date('2026-01-01T00:00:00Z'));
  doc.setModificationDate(new Date('2026-01-01T00:00:00Z'));
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const width = PAGE_W - MARGIN * 2;

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  const tagPages: Record<string, number[]> = {};

  const pageNo = () => doc.getPageCount();
  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  };
  const ensure = (needed: number) => {
    if (y - needed < MARGIN) newPage();
  };
  const note = (tag: string | undefined) => {
    if (!tag) return;
    const list = (tagPages[tag] ??= []);
    if (!list.includes(pageNo())) list.push(pageNo());
  };
  const drawLines = (lines: string[], font: PDFFont, size: number, lineHeight: number, tag?: string, x = MARGIN) => {
    for (const line of lines) {
      ensure(lineHeight);
      note(tag);
      page.drawText(line, { x, y: y - size, size, font, color: rgb(0.1, 0.1, 0.1) });
      y -= lineHeight;
    }
  };

  for (const block of blocks) {
    switch (block.kind) {
      case 'title': {
        const lines = wrap(block.text, bold, 16, width);
        drawLines(lines, bold, 16, 22);
        y -= 10;
        break;
      }
      case 'heading': {
        ensure(LINE * 3);
        y -= 8;
        drawLines(wrap(block.text, bold, 12, width), bold, 12, 17, block.tag);
        y -= 3;
        break;
      }
      case 'para': {
        drawLines(wrap(block.text, regular, BODY, width), regular, BODY, LINE, block.tag);
        y -= 6;
        break;
      }
      case 'kv': {
        const keyWidth = 200;
        const keyLines = wrap(block.key, bold, BODY, keyWidth - 8);
        const valueLines = wrap(block.value, regular, BODY, width - keyWidth);
        const rows = Math.max(keyLines.length, valueLines.length);
        ensure(rows * LINE);
        for (let i = 0; i < rows; i++) {
          note(block.tag);
          const k = keyLines[i];
          const v = valueLines[i];
          if (k) page.drawText(k, { x: MARGIN, y: y - BODY, size: BODY, font: bold });
          if (v) page.drawText(v, { x: MARGIN + keyWidth, y: y - BODY, size: BODY, font: regular });
          y -= LINE;
        }
        y -= 2;
        break;
      }
      case 'spacer':
        y -= LINE;
        break;
    }
  }

  const total = doc.getPageCount();
  doc.getPages().forEach((p, i) => {
    const footer = `Page ${i + 1} of ${total}`;
    p.drawText(footer, {
      x: PAGE_W - MARGIN - regular.widthOfTextAtSize(footer, 9),
      y: MARGIN / 2,
      size: 9,
      font: regular,
      color: rgb(0.4, 0.4, 0.4),
    });
  });

  return { bytes: await doc.save(), pageCount: total, tagPages };
}
