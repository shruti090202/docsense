import type { Chunk, ParsedPage } from './types.js';

export interface ChunkOptions {
  maxTokens: number;
  overlapTokens: number;
  minTokens: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { maxTokens: 400, overlapTokens: 60, minTokens: 15 };

// ~4 characters per token is close enough for English legal text and needs no tokenizer download.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const NUMBERED = /^\s*(\d{1,2}(?:\.\d{1,2}){0,3})[.)]?\s+([A-Z][^\n]{2,79})$/;
const KEYWORD = /^\s*(ARTICLE|CLAUSE|SECTION|SCHEDULE|ANNEXURE|ANNEX|PART|CHAPTER)\s+(\d+|[IVXLC]+|[A-Z])\b[^\n]{0,70}$/i;
const ALL_CAPS = /^[A-Z0-9][A-Z0-9 ,&/()'-]{3,79}$/;

export function isHeading(line: string): boolean {
  const t = line.trim();
  if (t.length < 3 || t.length > 80) return false;
  if (KEYWORD.test(t)) return true;
  if (ALL_CAPS.test(t)) {
    const words = t.split(/\s+/).filter((w) => /[A-Z]{3,}/.test(w));
    return words.length >= 2;
  }
  const m = NUMBERED.exec(t);
  if (!m) return false;
  const title = m[2]!;
  const wordCount = title.split(/\s+/).length;
  // a numbered sentence ("5. The Borrower shall...") is body text, not a heading
  return wordCount <= 10 && !/[.;]$/.test(title);
}

interface Line {
  text: string;
  page: number;
}

interface Section {
  title: string | null;
  lines: Line[];
}

function toLines(pages: ParsedPage[]): Line[] {
  const lines: Line[] = [];
  for (const p of pages) {
    for (const raw of p.text.split('\n')) {
      const text = raw.replace(/\s+/g, ' ').trim();
      if (text) lines.push({ text, page: p.page });
    }
  }
  return lines;
}

function toSections(lines: Line[], minTokens: number): Section[] {
  const sections: Section[] = [];
  let current: Section = { title: null, lines: [] };
  for (const line of lines) {
    if (isHeading(line.text)) {
      if (current.lines.length) sections.push(current);
      current = { title: line.text, lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.length) sections.push(current);

  // Only heading-only stubs (e.g. "ARTICLE III" directly followed by "3.1 Interest") are folded into their successor;
  // a short clause with a real sentence keeps its own title so citations stay precise.
  const merged: Section[] = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]!;
    const next = sections[i + 1];
    const tokens = estimateTokens(s.lines.map((l) => l.text).join('\n'));
    if (tokens < minTokens && next) {
      next.title = s.title && next.title ? `${s.title} > ${next.title}` : (next.title ?? s.title);
      next.lines = [...s.lines, ...next.lines];
      continue;
    }
    merged.push(s);
  }
  return merged;
}

interface Segment {
  text: string;
  page: number;
}

// Split a section into sentence-ish segments that never cross a line's page boundary.
function toSegments(lines: Line[]): Segment[] {
  const segments: Segment[] = [];
  for (const line of lines) {
    const parts = line.text.split(/(?<=[.;:])\s+(?=[A-Z0-9(])/);
    for (const part of parts) if (part.trim()) segments.push({ text: part.trim(), page: line.page });
  }
  return segments;
}

function packSegments(segments: Segment[], title: string | null, opts: ChunkOptions): Omit<Chunk, 'index'>[] {
  const out: Omit<Chunk, 'index'>[] = [];
  const titleTokens = title ? estimateTokens(title) + 1 : 0;
  let start = 0;
  while (start < segments.length) {
    let end = start;
    let tokens = titleTokens;
    while (end < segments.length) {
      const t = estimateTokens(segments[end]!.text) + 1;
      if (tokens + t > opts.maxTokens && end > start) break;
      tokens += t;
      end += 1;
    }
    const window = segments.slice(start, end);
    const body = window.map((s) => s.text).join(' ');
    const content = title && start > 0 ? `${title}\n${body}` : body;
    out.push({
      clauseTitle: title,
      content,
      pageStart: window[0]!.page,
      pageEnd: window[window.length - 1]!.page,
      tokenCount: estimateTokens(content),
    });
    if (end >= segments.length) break;
    // step back far enough to carry `overlapTokens` of context into the next window
    let overlap = 0;
    let next = end;
    while (next > start + 1 && overlap < opts.overlapTokens) {
      next -= 1;
      overlap += estimateTokens(segments[next]!.text) + 1;
    }
    start = next;
  }
  return out;
}

export function chunkDocument(pages: ParsedPage[], options: Partial<ChunkOptions> = {}): Chunk[] {
  const opts = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  const sections = toSections(toLines(pages), opts.minTokens);
  const chunks: Chunk[] = [];
  for (const section of sections) {
    const text = section.lines.map((l) => l.text).join('\n');
    if (estimateTokens(text) <= opts.maxTokens) {
      chunks.push({
        index: chunks.length,
        clauseTitle: section.title,
        content: text,
        pageStart: section.lines[0]!.page,
        pageEnd: section.lines[section.lines.length - 1]!.page,
        tokenCount: estimateTokens(text),
      });
      continue;
    }
    for (const c of packSegments(toSegments(section.lines), section.title, opts)) {
      chunks.push({ index: chunks.length, ...c });
    }
  }
  return chunks;
}
