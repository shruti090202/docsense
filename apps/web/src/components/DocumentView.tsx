import { useCallback, useEffect, useState } from 'react';
import type { Citation } from '@docsense/shared';
import { api } from '../api/client.js';
import { piiSummary, unmask } from '../lib/pii.js';
import { useDispatch, type LoadedDoc } from '../state/store.js';
import { ChatPanel } from './ChatPanel.jsx';
import { DocxViewer } from './DocxViewer.jsx';
import { ErrorBoundary } from './ErrorBoundary.jsx';
import { PdfViewer } from './PdfViewer.jsx';
import { RisksPanel } from './RisksPanel.jsx';
import { TermsPanel } from './TermsPanel.jsx';

type Tab = 'ask' | 'terms' | 'risks';

const STATUS: Record<LoadedDoc['analysis'], string> = {
  idle: 'Queued for analysis',
  extracting: 'Extracting key terms…',
  reviewing: 'Reviewing clauses for risks…',
  done: 'Analysis complete',
  error: 'Analysis failed',
};

export function DocumentView({ doc }: { doc: LoadedDoc }) {
  const dispatch = useDispatch();
  const [tab, setTab] = useState<Tab>('ask');
  const [highlightText, setHighlightText] = useState<string | null>(null);
  const chunkCache = useState(() => new Map<string, string>())[0];

  useEffect(() => {
    if (!doc.highlight) {
      setHighlightText(null);
      return;
    }
    const { chunkId } = doc.highlight;
    const cached = chunkCache.get(chunkId);
    if (cached) {
      setHighlightText(cached);
      return;
    }
    let cancelled = false;
    api
      .chunk(doc.id, chunkId)
      .then((c) => {
        // the stored chunk is masked; restore identifiers so it matches the on-screen text
        const text = unmask(c.content, doc.piiMap);
        chunkCache.set(chunkId, text);
        if (!cancelled) setHighlightText(text);
      })
      .catch(() => {
        if (!cancelled) setHighlightText(null);
      });
    return () => {
      cancelled = true;
    };
  }, [doc.highlight, doc.id, doc.piiMap, chunkCache]);

  const onCitation = useCallback(
    (c: Citation) => {
      dispatch({ type: 'highlight', id: doc.id, highlight: { chunkId: c.chunkId, page: c.page, pageEnd: c.pageEnd ?? c.page, nonce: Date.now() } });
    },
    [dispatch, doc.id],
  );

  return (
    <div className="doc-view">
      <ErrorBoundary fallback={(m) => <div className="viewer empty">The document could not be rendered: {m}</div>}>
        {doc.sourceType === 'pdf' ? (
          <PdfViewer file={doc.file} highlight={doc.highlight} highlightText={highlightText} />
        ) : (
          <DocxViewer file={doc.file} highlight={doc.highlight} highlightText={highlightText} />
        )}
      </ErrorBoundary>
      <aside className="panel">
        <div className="status-line">
          <span className={`dot ${doc.analysis === 'done' ? 'done' : doc.analysis === 'error' ? 'error' : ''}`} />
          <span>{STATUS[doc.analysis]}</span>
          <span>·</span>
          <span title="Identifiers are replaced with placeholders before anything leaves the server">masked: {piiSummary(doc.piiMap)}</span>
        </div>
        <div className="panel-tabs">
          <button type="button" className={tab === 'ask' ? 'active' : ''} onClick={() => setTab('ask')}>
            Ask
          </button>
          <button type="button" className={tab === 'terms' ? 'active' : ''} onClick={() => setTab('terms')}>
            Terms &amp; cost
          </button>
          <button type="button" className={tab === 'risks' ? 'active' : ''} onClick={() => setTab('risks')}>
            Risks{doc.risks && doc.risks.length > 0 && <span className="count">{doc.risks.length}</span>}
          </button>
        </div>
        {tab === 'ask' && <ChatPanel doc={doc} onCitation={onCitation} />}
        {tab === 'terms' && <TermsPanel doc={doc} onCitation={onCitation} />}
        {tab === 'risks' && <RisksPanel doc={doc} onCitation={onCitation} />}
      </aside>
    </div>
  );
}
