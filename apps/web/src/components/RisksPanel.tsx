import type { Citation } from '@docsense/shared';
import { unmask } from '../lib/pii.js';
import type { LoadedDoc } from '../state/store.js';
import { CitationChip } from './Citations.jsx';

interface Props {
  doc: LoadedDoc;
  onCitation: (c: Citation) => void;
}

const LABELS: Record<string, string> = {
  auto_debit_mandate: 'Auto-debit mandate',
  penal_interest: 'Penal interest',
  unilateral_rate_change: 'Unilateral rate change',
  broad_data_sharing: 'Data sharing',
  one_sided_termination: 'One-sided termination',
  arbitration: 'Arbitration',
  cross_default: 'Cross-default',
  security_interest: 'Security over assets',
  auto_renewal: 'Automatic renewal',
  lock_in: 'Lock-in period',
  deposit_forfeiture: 'Deposit forfeiture',
  broad_indemnity: 'Indemnity',
  non_compete: 'Non-compete',
  liability_limitation: 'Liability cap',
  unilateral_amendment: 'Unilateral changes',
};

export function RisksPanel({ doc, onCitation }: Props) {
  if (doc.risks === null) {
    return (
      <div className="panel-body">
        {doc.analysis === 'error' ? <div className="callout">{doc.analysisError}</div> : <div className="empty">Reviewing clauses for risks…</div>}
      </div>
    );
  }
  if (doc.risks.length === 0) return <div className="panel-body empty">No risky clauses were confirmed in this document.</div>;
  return (
    <div className="panel-body">
      <div className="callout info">
        Each flag was found by a rule-based scan and then confirmed by the model against the clause text, from the {doc.kind === 'loan' ? "borrower's" : 'weaker party’s'} point of view. Click the page to read the clause yourself.
      </div>
      {doc.risks.map((r) => (
        <div key={r.category} className={`risk ${r.severity}`}>
          <h4>
            <span>{r.title}</span>
            <span className={`badge ${r.severity}`}>{r.severity}</span>
          </h4>
          <p>{unmask(r.explanation, doc.piiMap)}</p>
          <small>
            {LABELS[r.category] ?? r.category} · <CitationChip citation={r.citation} onSelect={onCitation} />
            {r.citation.clauseTitle ? ` ${r.citation.clauseTitle}` : ''}
          </small>
        </div>
      ))}
    </div>
  );
}
