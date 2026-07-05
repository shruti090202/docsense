import type { Citation, LoanTerms } from '@docsense/shared';
import { fee, money, months, percent } from '../lib/format.js';
import { unmask } from '../lib/pii.js';
import { runAnalysis } from '../state/actions.js';
import { useDispatch, type LoadedDoc } from '../state/store.js';
import { CitationChip } from './Citations.jsx';

interface Props {
  doc: LoadedDoc;
  onCitation: (c: Citation) => void;
}

type Evidence = { citation: Citation | null; confidence: number; notFound: boolean };

function Row({ label, value, evidence, onCitation, desc }: { label: string; value: string; evidence: Evidence; onCitation: (c: Citation) => void; desc?: string | null }) {
  return (
    <tr>
      <th>{label}</th>
      <td>
        {evidence.notFound ? (
          <span className="notfound">Not stated</span>
        ) : (
          <>
            {value}
            <span className="confidence" title={`confidence ${(evidence.confidence * 100).toFixed(0)}%`}>
              <i style={{ width: `${Math.round(evidence.confidence * 100)}%` }} />
            </span>
            {desc && <span className="desc">{desc}</span>}
          </>
        )}
      </td>
      <td>{evidence.citation && <CitationChip citation={evidence.citation} onSelect={onCitation} />}</td>
    </tr>
  );
}

export function TermsPanel({ doc, onCitation }: Props) {
  const dispatch = useDispatch();
  const t: LoanTerms | null = doc.terms;
  const reveal = (s: string | null) => (s ? unmask(s, doc.piiMap) : s);

  if (!t) {
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
          <div className="empty">Extracting the key terms…</div>
        )}
      </div>
    );
  }

  const cost = doc.cost?.cost ?? null;
  const rate = t.interestRate;
  const rateText = rate.annualPercent === null ? '' : `${percent(rate.annualPercent)} p.a. · ${rate.rateType}${rate.method !== 'unknown' ? `, ${rate.method} balance` : ''}`;

  return (
    <div className="panel-body">
      {cost ? (
        <div className="cost-grid">
          <div className="cost-card hero">
            <div className="label">Effective annual rate (true cost)</div>
            <div className="value">{percent(cost.effectiveAnnualRatePercent)}</div>
            <div className="sub">
              APR {percent(cost.aprPercent)} · contracted {percent(rate.annualPercent)}
              {rate.method === 'flat' ? ' flat' : ''} · includes {money(cost.upfrontFees, true)} upfront fees
            </div>
          </div>
          <div className="cost-card">
            <div className="label">EMI</div>
            <div className="value">{money(cost.emi)}</div>
            <div className="sub">× {cost.tenureMonths}</div>
          </div>
          <div className="cost-card">
            <div className="label">Total interest</div>
            <div className="value">{money(cost.totalInterest, true)}</div>
            <div className="sub">repay {money(cost.totalRepayment, true)}</div>
          </div>
          <div className="cost-card">
            <div className="label">You actually receive</div>
            <div className="value">{money(cost.netDisbursal, true)}</div>
            <div className="sub">after {doc.cost?.upfrontBreakdown.map((b) => b.label.toLowerCase()).join(', ') || 'no upfront fees'}</div>
          </div>
          <div className="cost-card">
            <div className="label">Total cost of credit</div>
            <div className="value">{money(cost.totalCostOfCredit, true)}</div>
            <div className="sub">interest + upfront fees</div>
          </div>
        </div>
      ) : (
        <div className="callout">
          Cost could not be computed: {doc.cost?.missing.join(', ') || 'missing inputs'}. The figures below are what was found.
        </div>
      )}
      <div className="callout info">All numbers above are computed by code from the extracted terms, not by the AI model.</div>
      <table className="terms">
        <tbody>
          <Row label="Lender" value={reveal(t.lenderName.value) ?? ''} evidence={t.lenderName} onCitation={onCitation} />
          <Row label="Loan amount" value={money(t.principal.amount, true)} evidence={t.principal} onCitation={onCitation} />
          <Row label="Interest rate" value={rateText} evidence={rate} onCitation={onCitation} desc={rate.benchmark ? `Benchmark: ${rate.benchmark}` : null} />
          <Row label="Tenure" value={months(t.tenureMonths.value)} evidence={t.tenureMonths} onCitation={onCitation} />
          <Row label="Stated EMI" value={money(t.statedEmi.amount)} evidence={t.statedEmi} onCitation={onCitation} />
          <Row label="Processing fee" value={fee(t.processingFee)} evidence={t.processingFee} onCitation={onCitation} desc={t.processingFee.description} />
          <Row label="Insurance premium" value={fee(t.insurancePremium)} evidence={t.insurancePremium} onCitation={onCitation} desc={t.insurancePremium.description} />
          {t.otherUpfrontCharges.map((f, i) => (
            <Row key={i} label={f.description ?? `Other charge ${i + 1}`} value={fee(f)} evidence={f} onCitation={onCitation} />
          ))}
          <Row label="Prepayment / foreclosure" value={fee(t.prepaymentCharges)} evidence={t.prepaymentCharges} onCitation={onCitation} desc={t.prepaymentCharges.description} />
          <Row label="Late payment / penal" value={fee(t.latePaymentCharges)} evidence={t.latePaymentCharges} onCitation={onCitation} desc={t.latePaymentCharges.description} />
          <Row label="Bounce charges" value={fee(t.bounceCharges)} evidence={t.bounceCharges} onCitation={onCitation} desc={t.bounceCharges.description} />
        </tbody>
      </table>
    </div>
  );
}
