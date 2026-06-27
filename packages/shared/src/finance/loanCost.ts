import { emiFlat, emiReducing, round2 } from './emi.js';

export type InterestMethod = 'reducing' | 'flat';

export interface LoanCostInput {
  principal: number;
  annualRatePercent: number;
  tenureMonths: number;
  method: InterestMethod;
  // fees paid or deducted at disbursement: processing fee, insurance, documentation, stamp duty...
  upfrontFees: number;
  // when the document states an EMI, use it instead of the formula (documents sometimes round up)
  statedEmi?: number | undefined;
}

export interface LoanCostResult {
  emi: number;
  tenureMonths: number;
  totalRepayment: number;
  totalInterest: number;
  upfrontFees: number;
  netDisbursal: number;
  totalCostOfCredit: number;
  // annualised IRR of the borrower's real cash flows (net disbursal in, EMIs out), compounded monthly
  effectiveAnnualRatePercent: number;
  // the same IRR expressed as a simple nominal annual rate (monthly IRR x 12), the RBI KFS "APR" convention
  aprPercent: number;
}

// Net present value of cash flows at a periodic rate; cashflows[0] is at t=0.
export function npv(rate: number, cashflows: number[]): number {
  let total = 0;
  let discount = 1;
  for (const cf of cashflows) {
    total += cf / discount;
    discount *= 1 + rate;
  }
  return total;
}

function npvDerivative(rate: number, cashflows: number[]): number {
  let total = 0;
  for (let t = 1; t < cashflows.length; t++) {
    total -= (t * cashflows[t]!) / Math.pow(1 + rate, t + 1);
  }
  return total;
}

// Periodic internal rate of return. Newton from a sensible seed, falling back to bisection on the sign
// change bracket when Newton wanders; loan cash flows (one inflow, then outflows) have a unique root.
export function irr(cashflows: number[], opts: { tolerance?: number; maxIterations?: number } = {}): number {
  const tolerance = opts.tolerance ?? 1e-10;
  const maxIterations = opts.maxIterations ?? 100;
  if (cashflows.length < 2) throw new RangeError('at least two cash flows are required');
  const hasIn = cashflows.some((c) => c > 0);
  const hasOut = cashflows.some((c) => c < 0);
  if (!hasIn || !hasOut) throw new RangeError('cash flows must contain both inflows and outflows');

  let rate = 0.01;
  for (let i = 0; i < maxIterations; i++) {
    const f = npv(rate, cashflows);
    if (Math.abs(f) < tolerance) return rate;
    const d = npvDerivative(rate, cashflows);
    if (d === 0) break;
    const next = rate - f / d;
    if (!Number.isFinite(next) || next <= -0.99 || next > 10) break;
    if (Math.abs(next - rate) < tolerance) return next;
    rate = next;
  }

  let lo = -0.99;
  let hi = 10;
  let fLo = npv(lo, cashflows);
  if (Math.sign(fLo) === Math.sign(npv(hi, cashflows))) throw new RangeError('no IRR in the search interval');
  for (let i = 0; i < 400; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid, cashflows);
    if (Math.abs(fMid) < tolerance || hi - lo < tolerance) return mid;
    if (Math.sign(fMid) === Math.sign(fLo)) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

export function loanCost(input: LoanCostInput): LoanCostResult {
  const { principal, annualRatePercent, tenureMonths, method, upfrontFees } = input;
  if (principal <= 0) throw new RangeError('principal must be positive');
  if (tenureMonths <= 0 || !Number.isInteger(tenureMonths)) throw new RangeError('tenure must be a positive whole number of months');
  if (annualRatePercent < 0) throw new RangeError('interest rate cannot be negative');
  if (upfrontFees < 0 || upfrontFees >= principal) throw new RangeError('upfront fees must be non-negative and smaller than the principal');

  const formulaEmi = method === 'flat' ? emiFlat(principal, annualRatePercent, tenureMonths) : emiReducing(principal, annualRatePercent, tenureMonths);
  const emi = round2(input.statedEmi && input.statedEmi > 0 ? input.statedEmi : formulaEmi);
  const totalRepayment = round2(emi * tenureMonths);
  const totalInterest = round2(totalRepayment - principal);
  const netDisbursal = round2(principal - upfrontFees);
  const cashflows = [netDisbursal, ...Array.from({ length: tenureMonths }, () => -emi)];
  const monthly = irr(cashflows);
  return {
    emi,
    tenureMonths,
    totalRepayment,
    totalInterest,
    upfrontFees: round2(upfrontFees),
    netDisbursal,
    totalCostOfCredit: round2(totalInterest + upfrontFees),
    effectiveAnnualRatePercent: round2((Math.pow(1 + monthly, 12) - 1) * 100),
    aprPercent: round2(monthly * 12 * 100),
  };
}
