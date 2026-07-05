import type { Citation } from '@docsense/shared';
import { unmask } from '../lib/pii.js';
import { runAnalysis } from '../state/actions.js';
import { useDispatch, type LoadedDoc } from '../state/store.js';
import { CitationChip } from './Citations.jsx';

interface Props {
  doc: LoadedDoc;
  onCitation: (c: Citation) => void;
}

export function OutlinePanel({ doc, onCitation }: Props) {
  const dispatch = useDispatch();
  const outline = doc.outline;
  if (!outline) {
    return (
      <div className="panel-body">
        {doc.analysis === 'error' ? (
          <>
            <div className="callout">{doc.analysisError}</div>
            <button className="btn" type="button" onClick={() => void runAnalysis(dispatch, doc.id, doc.kind)}>
              Retry
            </button>
          </>
        ) : (
          <div className="empty">Outlining the document…</div>
        )}
      </div>
    );
  }
  return (
    <div className="panel-body">
      <h3 className="outline-title">{unmask(outline.title, doc.piiMap)}</h3>
      <p className="outline-summary">{unmask(outline.summary, doc.piiMap)}</p>
      <ol className="outline">
        {outline.sections.map((s, i) => (
          <li key={i}>
            <div className="outline-heading">
              <span>{unmask(s.heading, doc.piiMap)}</span>
              {s.citation && <CitationChip citation={s.citation} onSelect={onCitation} />}
            </div>
            <div className="outline-gist">{unmask(s.gist, doc.piiMap)}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}
