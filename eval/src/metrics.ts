import type { Citation, LoanTerms } from '@docsense/shared';
import type { Expect } from './golden.js';

// "Rs. 17,088.81", "1,15,197", "17.97%" -> numbers; Indian grouping is fine because commas are dropped.
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(?<![\w.])(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?![\w])/g)) {
    const n = Number(m[1]!.replace(/,/g, ''));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

const NIL = /\b(nil|no (?:prepayment |foreclosure )?charge|without (?:any )?charge|free of charge|not charged|no penalty|0%)\b/i;

export function checkNumeric(answer: string, value: number, tolerance = 0.01): boolean {
  if (value === 0) return NIL.test(answer) || numbersIn(answer).includes(0);
  const tol = Math.max(Math.abs(value) * tolerance, 0.01);
  return numbersIn(answer).some((n) => Math.abs(n - value) <= tol);
}

export function checkText(answer: string, keywords: string[]): boolean {
  const a = answer.toLowerCase();
  return keywords.every((k) => a.includes(k.toLowerCase()));
}

// A correct refusal has no citations and says so; a wrong one confidently cites something.
export function checkNotInDocument(answer: string, citations: Citation[]): boolean {
  return citations.length === 0 && /(does not|doesn't|not (?:state|mention|specify|contain|provide|appear)|no (?:mention|information))/i.test(answer);
}

export function checkExpect(expect: Expect, answer: string, citations: Citation[]): boolean {
  switch (expect.type) {
    case 'numeric':
      return checkNumeric(answer, expect.value, expect.tolerance);
    case 'text':
      return checkText(answer, expect.keywords);
    case 'not_in_document':
      return checkNotInDocument(answer, citations);
  }
}

export function pagesOverlap(pageStart: number, pageEnd: number, expected: number[]): boolean {
  return expected.some((p) => p >= pageStart && p <= pageEnd);
}

export function citationsHit(citations: Citation[], expected: number[]): boolean {
  return citations.some((c) => pagesOverlap(c.page, c.pageEnd ?? c.page, expected));
}

// Per-field extraction scoring against the generator's ground truth.
export interface FieldResult {
  field: string;
  correct: boolean;
  expected: string;
  got: string;
}

const close = (a: number | null | undefined, b: number | null | undefined, rel = 0.005) =>
  a !== null && a !== undefined && b !== null && b !== undefined && Math.abs(a - b) <= Math.max(Math.abs(b) * rel, 0.01);

export function scoreExtraction(terms: LoanTerms, truth: Record<string, any>): FieldResult[] {
  const t = truth.terms;
  const principal = t.principal.amount as number;
  const feeAmount = (f: { amount: number | null; percent: number | null }) => (f.amount !== null && f.amount > 0 ? f.amount : f.percent !== null ? (principal * f.percent) / 100 : 0);
  const results: FieldResult[] = [];
  const add = (field: string, correct: boolean, expected: unknown, got: unknown) => results.push({ field, correct, expected: String(expected), got: String(got) });

  add('lenderName', (terms.lenderName.value ?? '').trim().toLowerCase() === String(t.lenderName.value).toLowerCase(), t.lenderName.value, terms.lenderName.value);
  add('principal', close(terms.principal.amount, principal), principal, terms.principal.amount);
  add('interestRate.annualPercent', close(terms.interestRate.annualPercent, t.interestRate.annualPercent, 0.001), t.interestRate.annualPercent, terms.interestRate.annualPercent);
  add('interestRate.rateType', terms.interestRate.rateType === t.interestRate.rateType, t.interestRate.rateType, terms.interestRate.rateType);
  add('interestRate.method', terms.interestRate.method === t.interestRate.method, t.interestRate.method, terms.interestRate.method);
  add('tenureMonths', terms.tenureMonths.value === t.tenureMonths.value, t.tenureMonths.value, terms.tenureMonths.value);
  add('statedEmi', close(terms.statedEmi.amount, t.statedEmi.amount, 0.001), t.statedEmi.amount, terms.statedEmi.amount);
  add('processingFee', close(feeAmount(terms.processingFee), t.processingFee.resolvedAmount, 0.01), t.processingFee.resolvedAmount, feeAmount(terms.processingFee));
  const insTruth = t.insurancePremium.amount ?? 0;
  add('insurancePremium', close(feeAmount(terms.insurancePremium), insTruth, 0.01), insTruth, feeAmount(terms.insurancePremium));
  const otherTruth = (t.otherUpfrontCharges as { amount: number | null; percent: number | null }[]).reduce((s, f) => s + feeAmount(f), 0);
  const otherGot = terms.otherUpfrontCharges.reduce((s, f) => s + feeAmount(f), 0);
  add('otherUpfrontCharges.total', close(otherGot, otherTruth, 0.01) || (otherTruth === 0 && otherGot === 0), otherTruth, otherGot);
  const prepayTruth = t.prepaymentCharges.percent ?? t.prepaymentCharges.amount ?? 0;
  const prepayGot = terms.prepaymentCharges.notFound ? null : (terms.prepaymentCharges.percent ?? terms.prepaymentCharges.amount ?? null);
  add('prepaymentCharges', prepayTruth === 0 ? prepayGot === 0 : close(prepayGot, prepayTruth, 0.001), prepayTruth, prepayGot);
  add('latePaymentCharges', close(terms.latePaymentCharges.percent, t.latePaymentCharges.percent, 0.001), t.latePaymentCharges.percent, terms.latePaymentCharges.percent);
  add('bounceCharges', close(terms.bounceCharges.amount, t.bounceCharges.amount, 0.001), t.bounceCharges.amount, terms.bounceCharges.amount);
  return results;
}

export function mean(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

export function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
