import { useEffect, useMemo, useRef, useState } from 'react';
import { buildMatcher } from '../lib/highlight.js';
import type { Highlight } from '../state/store.js';

interface Props {
  file: Blob;
  highlight: Highlight | null;
  highlightText: string | null;
}

// DOCX has no pages, so the file is rendered as flowing text and cited paragraphs are marked.
export function DocxViewer({ file, highlight, highlightText }: Props) {
  const [paragraphs, setParagraphs] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const firstMark = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mammoth = await import('mammoth/mammoth.browser.js');
        const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
        if (!cancelled) setParagraphs(result.value.split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean));
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  const matcher = useMemo(() => (highlightText ? buildMatcher(highlightText) : null), [highlightText]);

  useEffect(() => {
    const mark = firstMark.current;
    const el = mark?.closest('.viewer') as HTMLElement | null;
    if (!mark || !el) return;
    el.scrollTo({ top: mark.offsetTop - el.offsetTop - el.clientHeight / 3, behavior: 'smooth' });
  }, [highlight, paragraphs]);

  if (error) return <div className="empty">Could not render this DOCX: {error}</div>;
  if (!paragraphs) return <div className="empty">Rendering document…</div>;

  let marked = false;
  return (
    <div className="viewer">
      <div className="docx-view">
        {paragraphs.map((p, i) => {
          const hit = matcher?.matches(p) ?? false;
          const ref = hit && !marked ? firstMark : undefined;
          if (hit) marked = true;
          return (
            <p key={i}>{hit ? <mark ref={ref as never}>{p}</mark> : p}</p>
          );
        })}
      </div>
    </div>
  );
}
