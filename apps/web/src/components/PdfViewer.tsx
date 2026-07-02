import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import { buildMatcher, escapeHtml } from '../lib/highlight.js';
import type { Highlight } from '../state/store.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

interface Props {
  file: Blob;
  highlight: Highlight | null;
  // unmasked text of the cited chunk, once fetched
  highlightText: string | null;
}

// Renders the user's own file from browser memory; the server never has the original bytes.
export function PdfViewer({ file, highlight, highlightText }: Props) {
  const [pageCount, setPageCount] = useState(0);
  const [width, setWidth] = useState(720);
  const container = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const measure = () => setWidth(Math.min(820, Math.max(320, el.clientWidth - 32)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // scroll only the viewer pane; scrollIntoView would also drag the surrounding page layout
  useEffect(() => {
    if (!highlight) return;
    const target = pageRefs.current[highlight.page];
    const el = container.current;
    if (!target || !el) return;
    el.scrollTo({ top: target.offsetTop - el.offsetTop - 8, behavior: 'smooth' });
  }, [highlight]);

  const matcher = useMemo(() => (highlightText ? buildMatcher(highlightText) : null), [highlightText]);
  const citedPages = useMemo(() => {
    if (!highlight) return new Set<number>();
    const pages = new Set<number>();
    for (let p = highlight.page; p <= highlight.pageEnd; p++) pages.add(p);
    return pages;
  }, [highlight]);

  const renderText = useCallback(
    (page: number) =>
      ({ str }: { str: string }) => {
        if (!matcher || !citedPages.has(page)) return escapeHtml(str);
        return matcher.matches(str) ? `<mark>${escapeHtml(str)}</mark>` : escapeHtml(str);
      },
    [matcher, citedPages],
  );

  return (
    <div className="viewer" ref={container}>
      <div className="viewer-inner">
        <Document file={file} onLoadSuccess={(doc) => setPageCount(doc.numPages)} loading={<div className="empty">Rendering document…</div>}>
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => (
            <div
              key={`${page}-${highlight?.nonce ?? 0}`}
              className={`pdf-page${citedPages.has(page) ? ' cited' : ''}`}
              ref={(el) => {
                pageRefs.current[page] = el;
              }}
            >
              <Page pageNumber={page} width={width} renderAnnotationLayer={false} customTextRenderer={renderText(page)} loading={null} />
            </div>
          ))}
        </Document>
      </div>
    </div>
  );
}
