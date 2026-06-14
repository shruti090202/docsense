// Deterministic loan arithmetic. Money is in major units (rupees); callers round for display.

export function monthlyRate(annualPercent: number): number {
  return annualPercent / 12 / 100;
}

// Reducing-balance EMI: P * r * (1+r)^n / ((1+r)^n - 1)
export function emiReducing(principal: number, annualPercent: number, tenureMonths: number): number {
  if (principal <= 0 || tenureMonths <= 0) throw new RangeError('principal and tenure must be positive');
  const r = monthlyRate(annualPercent);
  if (r === 0) return principal / tenureMonths;
  const growth = Math.pow(1 + r, tenureMonths);
  return (principal * r * growth) / (growth - 1);
}

// Flat-rate EMI: interest is charged on the full principal for the whole tenure
export function emiFlat(principal: number, annualPercent: number, tenureMonths: number): number {
  if (principal <= 0 || tenureMonths <= 0) throw new RangeError('principal and tenure must be positive');
  const totalInterest = (principal * annualPercent * tenureMonths) / (12 * 100);
  return (principal + totalInterest) / tenureMonths;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
