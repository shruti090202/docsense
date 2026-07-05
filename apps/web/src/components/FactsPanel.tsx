import type { Citation, ContractFacts } from '@docsense/shared';
import { unmask } from '../lib/pii.js';
import { runAnalysis } from '../state/actions.js';
import { useDispatch, type LoadedDoc } from '../state/store.js';
import { CitationChip } from './Citations.jsx';

interface Props {
  doc: LoadedDoc;
  onCitation: (c: Citation) => void;
}

const ROWS: [keyof ContractFacts, string][] = [
  ['documentType', 'Type of agreement'],
  ['parties', 'Parties'],
  ['effectiveDate', 'Starts'],
  ['term', 'Term'],
  ['paymentObligations', 'Payments'],
  ['securityDeposit', 'Deposit'],
  ['noticePeriod', 'Notice period'],
  ['terminationConditions', 'Termination'],
  ['renewal', 'Renewal'],
  ['governingLaw', 'Governing law & disputes'],
];

export function FactsPanel({ doc, onCitation }: Props) {
  const dispatch = useDispatch();
  const facts = doc.contractFacts;
  if (!facts) {
    return (
      <div className="panel-body">
        {doc.analysis === 'error' ? (
          <>
            <div className="callout">{doc.analysisError}</div>
            <button className="btn" type="button" onClick={() => void runAnalysis(dispatch, doc.id, doc.kind)}>
              Retry analysis
            </button>
          </>
        ) : (
          <div className="empty">Reading the key facts…</div>
        )}
      </div>
    );
  }
  return (
    <div className="panel-body">
      <div className="callout info">Each fact is quoted from the document and links to the clause it came from. Not legal advice.</div>
      <table className="terms">
        <tbody>
          {ROWS.map(([key, label]) => {
            const f = facts[key];
            const value = Array.isArray(f.value) ? f.value.join(' · ') : f.value;
            return (
              <tr key={key}>
                <th>{label}</th>
                <td>
                  {f.notFound || !value ? (
                    <span className="notfound">Not stated</span>
                  ) : (
                    <>
                      {unmask(value, doc.piiMap)}
                      <span className="confidence" title={`confidence ${(f.confidence * 100).toFixed(0)}%`}>
                        <i style={{ width: `${Math.round(f.confidence * 100)}%` }} />
                      </span>
                    </>
                  )}
                </td>
                <td>{f.citation && <CitationChip citation={f.citation} onSelect={onCitation} />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
