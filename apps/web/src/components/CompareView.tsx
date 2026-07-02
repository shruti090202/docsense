import { useState } from 'react';
import type { CompareResponse } from '@docsense/shared';
import { ApiError, api } from '../api/client.js';
import { fee, money, months, percent } from '../lib/format.js';
import { useDispatch, useStore } from '../state/store.js';

export function CompareView() {
  const { docs, order } = useStore();
  const dispatch = useDispatch();
  const [leftId, setLeftId] = useState(order[0] ?? '');
  const [rightId, setRightId] = useState(order[1] ?? '');
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!leftId || !rightId || leftId === rightId) return;
    setBusy(true);
    try {
      setResult(await api.compare(leftId, rightId));
    } catch (err) {
      dispatch({ type: 'toast', kind: 'error', text: err instanceof ApiError ? err.friendly : (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const options = order.map((id) => (
    <option key={id} value={id}>
      {docs[id]!.title}
    </option>
  ));

  const side = (s: CompareResponse['left']) => {
    const c = s.cost.cost;
    return {
      lender: s.terms.lenderName.value ?? '—',
      principal: money(s.terms.principal.amount, true),
      rate: s.terms.interestRate.annualPercent === null ? 'Not stated' : `${percent(s.terms.interestRate.annualPercent)} ${s.terms.interestRate.rateType}, ${s.terms.interestRate.method}`,
      tenure: months(s.terms.tenureMonths.value),
      emi: money(c?.emi ?? s.terms.statedEmi.amount),
      upfront: c ? money(c.upfrontFees, true) : '—',
      interest: c ? money(c.totalInterest, true) : '—',
      ear: c ? percent(c.effectiveAnnualRatePercent) : '—',
      apr: c ? percent(c.aprPercent) : '—',
      prepay: fee(s.terms.prepaymentCharges),
      penal: fee(s.terms.latePaymentCharges),
      bounce: fee(s.terms.bounceCharges),
      risks: s.riskFlags === null ? 'Not assessed' : s.riskFlags.length ? s.riskFlags.map((r) => `${r.severity}: ${r.title}`).join('; ') : 'None confirmed',
    };
  };

  const rows: [string, keyof ReturnType<typeof side>, boolean][] = [
    ['Lender', 'lender', false],
    ['Loan amount', 'principal', false],
    ['Interest rate', 'rate', false],
    ['Tenure', 'tenure', false],
    ['EMI', 'emi', false],
    ['Upfront fees', 'upfront', false],
    ['Total interest', 'interest', false],
    ['Effective annual rate', 'ear', true],
    ['APR', 'apr', true],
    ['Prepayment charges', 'prepay', false],
    ['Late payment / penal', 'penal', false],
    ['Bounce charges', 'bounce', false],
    ['Risk flags', 'risks', false],
  ];

  return (
    <div className="compare">
      <h1>Compare two offers</h1>
      <p className="lede">Extracted terms and code-computed costs side by side. The cheaper offer is the one with the lower effective annual rate.</p>
      {order.length < 2 ? (
        <div className="callout">Load at least two documents (upload or “Try a sample”) to compare them.</div>
      ) : (
        <div className="compare-pick">
          <select value={leftId} onChange={(e) => setLeftId(e.target.value)}>
            <option value="">Offer A…</option>
            {options}
          </select>
          <button className="btn primary" type="button" disabled={busy || !leftId || !rightId || leftId === rightId} onClick={() => void run()}>
            {busy ? 'Comparing…' : 'Compare'}
          </button>
          <select value={rightId} onChange={(e) => setRightId(e.target.value)}>
            <option value="">Offer B…</option>
            {options}
          </select>
        </div>
      )}
      {result && (
        <>
          <div className="summary-box">
            <strong>
              {result.cheaper === 'unknown' ? 'No clear winner on cost.' : `${result.cheaper === 'left' ? result.left.title : result.right.title} is cheaper by effective annual rate.`}
            </strong>
            <p>{result.summary}</p>
          </div>
          <table className="compare-table">
            <thead>
              <tr>
                <th />
                <th>{result.left.title}</th>
                <th>{result.right.title}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, key, isCost]) => {
                const l = side(result.left)[key];
                const r = side(result.right)[key];
                const winL = isCost && result.cheaper === 'left';
                const winR = isCost && result.cheaper === 'right';
                return (
                  <tr key={key}>
                    <th>{label}</th>
                    <td className={winL ? 'win' : ''}>{l}</td>
                    <td className={winR ? 'win' : ''}>{r}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {result.differences.length > 0 && (
            <>
              <h2 className="section">Key differences</h2>
              <table className="compare-table">
                <tbody>
                  {result.differences.map((d, i) => (
                    <tr key={i}>
                      <th>{d.aspect}</th>
                      <td className={d.favours === 'left' ? 'win' : ''}>{d.left}</td>
                      <td className={d.favours === 'right' ? 'win' : ''}>{d.right}</td>
                      <td>{d.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </div>
  );
}
