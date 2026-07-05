import { useCallback, useEffect, useState } from 'react';
import type { Citation } from '@docsense/shared';
import { api } from '../api/client.js';
import { piiSummary, unmask } from '../lib/pii.js';
import { useDispatch, type LoadedDoc } from '../state/store.js';
import { ChatPanel } from './ChatPanel.jsx';
import { DocxViewer } from './DocxViewer.jsx';
import { ErrorBoundary } from './ErrorBoundary.jsx';
import { FactsPanel } from './FactsPanel.jsx';
import { OutlinePanel } from './OutlinePanel.jsx';
import { PdfViewer } from './PdfViewer.jsx';
import { RisksPanel } from './RisksPanel.jsx';
import { TermsPanel } from './TermsPanel.jsx';

type Tab = 'ask' | 'analysis' | 'risks';

const KIND_LABEL: Record<LoadedDoc['kind'], string> = { loan: 'Loan agreement', contract: 'Contract', general: 'Document' };
const ANALYSIS_TAB: Record<LoadedDoc['kind'], string> = { loan: 'Terms & cost', contract: 'Key facts', general: 'Outline' };

const STATUS: Record<LoadedDoc['analysis'], string> = {
  idle: 'Queued for analysis',
  extracting: 'Reading the document…',
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
          <span className="badge kind" title="Detected from the document text; decides which analyses run">
            {KIND_LABEL[doc.kind]}
          </span>
          <span>{STATUS[doc.analysis]}</span>
          <span>·</span>
          <span title="Identifiers are replaced with placeholders before anything leaves the server">masked: {piiSummary(doc.piiMap)}</span>
        </div>
        <div className="panel-tabs">
          <button type="button" className={tab === 'ask' ? 'active' : ''} onClick={() => setTab('ask')}>
            Ask
          </button>
          <button type="button" className={tab === 'analysis' ? 'active' : ''} onClick={() => setTab('analysis')}>
            {ANALYSIS_TAB[doc.kind]}
          </button>
          {doc.kind !== 'general' && (
            <button type="button" className={tab === 'risks' ? 'active' : ''} onClick={() => setTab('risks')}>
              Risks{doc.risks && doc.risks.length > 0 && <span className="count">{doc.risks.length}</span>}
            </button>
          )}
        </div>
        {tab === 'ask' && <ChatPanel doc={doc} onCitation={onCitation} />}
        {tab === 'analysis' && doc.kind === 'loan' && <TermsPanel doc={doc} onCitation={onCitation} />}
        {tab === 'analysis' && doc.kind === 'contract' && <FactsPanel doc={doc} onCitation={onCitation} />}
        {tab === 'analysis' && doc.kind === 'general' && <OutlinePanel doc={doc} onCitation={onCitation} />}
        {tab === 'risks' && <RisksPanel doc={doc} onCitation={onCitation} />}
      </aside>
    </div>
  );
}
