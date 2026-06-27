import { describe, expect, it } from 'vitest';
import { emiReducing, round2 } from '../src/finance/emi.js';
import { irr, loanCost, npv } from '../src/finance/loanCost.js';

// Independent oracle: plain bisection on NPV, no shared code with the Newton path.
function bisectIrr(cashflows: number[]): number {
  let lo = -0.9;
  let hi = 5;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    if (Math.sign(npv(mid, cashflows)) === Math.sign(npv(lo, cashflows))) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

describe('npv', () => {
  it('discounts later cash flows', () => {
    expect(npv(0, [-100, 50, 50])).toBe(0);
    expect(npv(0.1, [-100, 110])).toBeCloseTo(0, 10);
    expect(npv(0.1, [-100, 60, 60])).toBeCloseTo(-100 + 60 / 1.1 + 60 / 1.21, 10);
  });
});

describe('irr', () => {
  it('recovers the contracted monthly rate for a fee-free reducing-balance loan', () => {
    const emi = emiReducing(1_000_000, 12, 24);
    const flows = [1_000_000, ...Array(24).fill(-emi)];
    expect(irr(flows)).toBeCloseTo(0.01, 10);
  });

  it('matches a textbook two-period example', () => {
    // -100 now, +60 and +60 later: IRR = 13.066...%
    expect(irr([-100, 60, 60])).toBeCloseTo(0.130662, 6);
  });

  it('agrees with an independent bisection solver on awkward inputs', () => {
    const cases = [
      [950_000, ...Array(60).fill(-21_247.04)],
      [4_000, ...Array(3).fill(-1_500)],
      [100_000, ...Array(120).fill(-1_000)],
      [200_000, ...Array(6).fill(-40_000)],
    ];
    for (const flows of cases) expect(irr(flows)).toBeCloseTo(bisectIrr(flows), 8);
  });

  it('rejects impossible inputs', () => {
    expect(() => irr([100])).toThrow(RangeError);
    expect(() => irr([100, 50, 50])).toThrow(RangeError);
    expect(() => irr([-100, -50])).toThrow(RangeError);
  });
});

describe('loanCost', () => {
  it('computes totals and matches the nominal rate when there are no fees', () => {
    const r = loanCost({ principal: 1_000_000, annualRatePercent: 10, tenureMonths: 60, method: 'reducing', upfrontFees: 0 });
    expect(r.emi).toBe(21247.04);
    expect(r.totalRepayment).toBe(1_274_822.4);
    expect(r.totalInterest).toBe(274_822.4);
    expect(r.netDisbursal).toBe(1_000_000);
    expect(r.aprPercent).toBeCloseTo(10, 2);
    expect(r.effectiveAnnualRatePercent).toBeCloseTo(round2((Math.pow(1 + 0.1 / 12, 12) - 1) * 100), 2);
  });

  it('upfront fees raise the effective rate but not the total interest', () => {
    const base = loanCost({ principal: 500_000, annualRatePercent: 14, tenureMonths: 36, method: 'reducing', upfrontFees: 0 });
    const withFees = loanCost({ principal: 500_000, annualRatePercent: 14, tenureMonths: 36, method: 'reducing', upfrontFees: 18_300 });
    expect(withFees.totalInterest).toBe(base.totalInterest);
    expect(withFees.netDisbursal).toBe(481_700);
    expect(withFees.totalCostOfCredit).toBe(round2(base.totalInterest + 18_300));
    expect(withFees.effectiveAnnualRatePercent).toBeGreaterThan(base.effectiveAnnualRatePercent);
    expect(withFees.aprPercent).toBeGreaterThan(14);
    expect(withFees.aprPercent).toBeLessThan(18);
  });

  it('exposes the hidden cost of a flat-rate loan', () => {
    const flat = loanCost({ principal: 800_000, annualRatePercent: 9.5, tenureMonths: 60, method: 'flat', upfrontFees: 0 });
    // 9.5% flat over 5 years: interest 380,000 on a balance that keeps shrinking
    expect(flat.emi).toBe(19_666.67);
    expect(flat.totalInterest).toBe(380_000.2);
    expect(flat.effectiveAnnualRatePercent).toBeGreaterThan(16);
    expect(flat.effectiveAnnualRatePercent).toBeLessThan(19);
  });

  it('prefers the EMI stated in the document when provided', () => {
    const r = loanCost({ principal: 1_000_000, annualRatePercent: 10, tenureMonths: 60, method: 'reducing', upfrontFees: 0, statedEmi: 21_250 });
    expect(r.emi).toBe(21_250);
    expect(r.totalRepayment).toBe(1_275_000);
    expect(r.aprPercent).toBeGreaterThan(10);
  });

  it('validates inputs', () => {
    expect(() => loanCost({ principal: 0, annualRatePercent: 10, tenureMonths: 12, method: 'reducing', upfrontFees: 0 })).toThrow(RangeError);
    expect(() => loanCost({ principal: 1000, annualRatePercent: 10, tenureMonths: 12.5, method: 'reducing', upfrontFees: 0 })).toThrow(RangeError);
    expect(() => loanCost({ principal: 1000, annualRatePercent: 10, tenureMonths: 12, method: 'reducing', upfrontFees: 1000 })).toThrow(RangeError);
    expect(() => loanCost({ principal: 1000, annualRatePercent: -1, tenureMonths: 12, method: 'reducing', upfrontFees: 0 })).toThrow(RangeError);
  });
});
