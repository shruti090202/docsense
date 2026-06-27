import type { LoanTerms } from '../schemas/loanTerms.js';
import { round2 } from './emi.js';
import { loanCost, type LoanCostResult } from './loanCost.js';

export interface CostFromTerms {
  cost: LoanCostResult | null;
  // fee lines that were folded into upfrontFees, for display
  upfrontBreakdown: { label: string; amount: number }[];
  // why the cost could not be computed, when it could not
  missing: string[];
}

function feeAmount(principal: number, fee: { amount: number | null; percent: number | null }): number {
  if (fee.amount !== null) return fee.amount;
  if (fee.percent !== null) return round2((principal * fee.percent) / 100);
  return 0;
}

// Turns extracted terms into the deterministic cost summary; every number here comes from code, never the model.
export function costFromTerms(terms: LoanTerms): CostFromTerms {
  const missing: string[] = [];
  const principal = terms.principal.amount;
  const rate = terms.interestRate.annualPercent;
  const tenure = terms.tenureMonths.value;
  if (principal === null) missing.push('principal');
  if (rate === null) missing.push('interest rate');
  if (tenure === null) missing.push('tenure');
  if (principal === null || rate === null || tenure === null) return { cost: null, upfrontBreakdown: [], missing };

  const breakdown: { label: string; amount: number }[] = [];
  const add = (label: string, fee: { amount: number | null; percent: number | null; notFound: boolean }) => {
    if (fee.notFound) return;
    const amount = feeAmount(principal, fee);
    if (amount > 0) breakdown.push({ label, amount });
  };
  add('Processing fee', terms.processingFee);
  add('Insurance premium', terms.insurancePremium);
  terms.otherUpfrontCharges.forEach((f, i) => add(f.description ?? `Other charge ${i + 1}`, f));
  const upfrontFees = round2(breakdown.reduce((s, b) => s + b.amount, 0));
  const method = terms.interestRate.method === 'flat' ? 'flat' : 'reducing';
  try {
    const cost = loanCost({
      principal,
      annualRatePercent: rate,
      tenureMonths: tenure,
      method,
      upfrontFees: Math.min(upfrontFees, principal - 1),
      statedEmi: terms.statedEmi.amount ?? undefined,
    });
    return { cost, upfrontBreakdown: breakdown, missing };
  } catch (err) {
    return { cost: null, upfrontBreakdown: breakdown, missing: [(err as Error).message] };
  }
}
