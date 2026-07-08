// Golden dataset: questions with expected answers and the pages the answer must come from.
// Expected values are resolved from the committed ground-truth JSON so they can never drift from the PDFs.

export type Expect =
  | { type: 'numeric'; value: number; tolerance?: number }
  | { type: 'text'; keywords: string[] }
  | { type: 'not_in_document' };

export interface GoldenQuestion {
  id: string;
  slug: string;
  question: string;
  expect: Expect;
  // ground-truth path whose `pages` array is the expected source (e.g. "terms.prepaymentCharges"),
  // or an explicit list of pages
  pagesFrom?: string;
  pages?: number[];
  // questions that require a calculator tool to answer correctly
  needsTool?: boolean;
  tags: ('ci' | 'tool' | 'nid')[];
}

const LOANS = ['personal-loan-fixed', 'home-loan-floating', 'vehicle-loan-flat', 'business-loan-kfs', 'education-loan-floating'];

function loanQuestions(slug: string, i: number): GoldenQuestion[] {
  const ci = i === 0 || i === 2;
  return [
    { id: `${slug}/rate`, slug, question: 'What is the rate of interest on this loan, and is it fixed or floating?', expect: { type: 'numeric', value: NaN }, pagesFrom: 'terms.interestRate', tags: ci ? ['ci'] : [] },
    { id: `${slug}/tenure`, slug, question: 'How many monthly instalments does the loan have?', expect: { type: 'numeric', value: NaN }, pagesFrom: 'terms.tenureMonths', tags: [] },
    { id: `${slug}/emi`, slug, question: 'What is the EMI amount stated in the agreement?', expect: { type: 'numeric', value: NaN }, pagesFrom: 'terms.statedEmi', tags: ci ? ['ci'] : [] },
    { id: `${slug}/principal`, slug, question: 'How much is being lent under this agreement?', expect: { type: 'numeric', value: NaN }, pagesFrom: 'terms.principal', tags: [] },
    { id: `${slug}/prepay`, slug, question: 'Can I foreclose this loan early, and what will it cost me?', expect: { type: 'numeric', value: NaN }, pagesFrom: 'terms.prepaymentCharges', tags: ci ? ['ci'] : [] },
    { id: `${slug}/bounce`, slug, question: 'What is charged if my EMI payment bounces?', expect: { type: 'numeric', value: NaN }, pagesFrom: 'terms.bounceCharges', tags: [] },
    { id: `${slug}/ear`, slug, question: 'Including every upfront charge, what is the effective annual interest rate I am really paying on this loan?', expect: { type: 'numeric', value: NaN, tolerance: 0.02 }, pagesFrom: 'terms.interestRate', needsTool: true, tags: ci ? ['ci', 'tool'] : ['tool'] },
    { id: `${slug}/interest-total`, slug, question: 'How much total interest will I pay over the full tenure if I pay every EMI on time?', expect: { type: 'numeric', value: NaN, tolerance: 0.01 }, pagesFrom: 'terms.statedEmi', needsTool: true, tags: ['tool'] },
  ];
}

export const GOLDEN: GoldenQuestion[] = [
  ...LOANS.flatMap((slug, i) => loanQuestions(slug, i)),

  // things the loan agreements do not say
  { id: 'personal-loan-fixed/nid-guarantor', slug: 'personal-loan-fixed', question: 'Who is the guarantor for this loan?', expect: { type: 'not_in_document' }, tags: ['ci', 'nid'] },
  { id: 'home-loan-floating/nid-moratorium', slug: 'home-loan-floating', question: 'How long is the moratorium period before EMIs start?', expect: { type: 'not_in_document' }, tags: ['nid'] },
  { id: 'vehicle-loan-flat/nid-cooling', slug: 'vehicle-loan-flat', question: 'Is there a cooling-off period during which I can return the loan without penalty?', expect: { type: 'not_in_document' }, tags: ['nid'] },
  { id: 'education-loan-floating/nid-collateral', slug: 'education-loan-floating', question: 'What collateral or property is mortgaged for this loan?', expect: { type: 'not_in_document' }, tags: ['nid'] },

  // text answers with specific wording
  { id: 'business-loan-kfs/cooling', slug: 'business-loan-kfs', question: 'Is there a cooling-off period?', expect: { type: 'text', keywords: ['3 working days'] }, pages: [1], tags: ['ci'] },
  { id: 'home-loan-floating/benchmark', slug: 'home-loan-floating', question: 'What benchmark is the floating rate linked to?', expect: { type: 'text', keywords: ['SPLR'] }, pagesFrom: 'terms.interestRate', tags: [] },
  { id: 'personal-loan-fixed/arbitration', slug: 'personal-loan-fixed', question: 'How are disputes resolved, and who appoints the arbitrator?', expect: { type: 'text', keywords: ['arbitrat', 'lender'] }, pages: [4], tags: [] },
  { id: 'vehicle-loan-flat/flat', slug: 'vehicle-loan-flat', question: 'Is interest calculated on the reducing balance or on the original principal?', expect: { type: 'text', keywords: ['flat'] }, pagesFrom: 'terms.interestRate', tags: ['ci'] },

  // residential lease (contract kind)
  { id: 'residential-lease/rent', slug: 'residential-lease', question: 'What is the monthly rent and when is it due?', expect: { type: 'numeric', value: 38000 }, pages: [1], tags: ['ci'] },
  { id: 'residential-lease/deposit', slug: 'residential-lease', question: 'How much is the security deposit?', expect: { type: 'numeric', value: 228000 }, pages: [1], tags: [] },
  { id: 'residential-lease/lockin', slug: 'residential-lease', question: 'How long is the lock-in period and what happens if I leave during it?', expect: { type: 'text', keywords: ['12 months', 'forfeit'] }, pages: [1], tags: ['ci'] },
  { id: 'residential-lease/notice', slug: 'residential-lease', question: 'How much notice do I need to give to end the agreement after the lock-in?', expect: { type: 'numeric', value: 60 }, pages: [2], tags: [] },
  { id: 'residential-lease/renewal', slug: 'residential-lease', question: 'Does the agreement renew automatically, and does the rent go up?', expect: { type: 'text', keywords: ['automatic', '10%'] }, pages: [1], tags: [] },
  { id: 'residential-lease/nid-parking', slug: 'residential-lease', question: 'Which parking slot is allotted to the tenant?', expect: { type: 'not_in_document' }, tags: ['nid'] },

  // lecture notes (general kind)
  { id: 'lecture-notes-tvm/pv', slug: 'lecture-notes-tvm', question: 'What was the present value of the scholarship in the worked example?', expect: { type: 'numeric', value: 39927 }, pages: [1], tags: ['ci'] },
  { id: 'lecture-notes-tvm/emi-example', slug: 'lecture-notes-tvm', question: 'In the EMI worked example, what is the monthly instalment?', expect: { type: 'numeric', value: 21247 }, pages: [1], tags: [] },
  { id: 'lecture-notes-tvm/ear', slug: 'lecture-notes-tvm', question: 'What effective annual rate does 12% compounded monthly work out to?', expect: { type: 'numeric', value: 12.68 }, pages: [1, 2], tags: [] },
  { id: 'lecture-notes-tvm/flat-error', slug: 'lecture-notes-tvm', question: 'What common student error do the notes warn about when building an amortisation schedule?', expect: { type: 'text', keywords: ['original principal'] }, pages: [1, 2], tags: [] },
  { id: 'lecture-notes-tvm/nid-lecturer', slug: 'lecture-notes-tvm', question: 'Who is the lecturer teaching this course?', expect: { type: 'not_in_document' }, tags: ['nid'] },
];

// Fill in numeric expectations from ground truth at run time.
export function resolveExpected(q: GoldenQuestion, truth: Record<string, unknown>): Expect {
  if (q.expect.type !== 'numeric' || !Number.isNaN(q.expect.value)) return q.expect;
  const terms = truth['terms'] as Record<string, Record<string, unknown>>;
  const computed = truth['computed'] as Record<string, number>;
  const principal = terms['principal']!['amount'] as number;
  const pct = (f: Record<string, unknown>) => (f['amount'] as number | null) ?? ((principal * (f['percent'] as number)) / 100);
  const byId: Record<string, number> = {
    rate: terms['interestRate']!['annualPercent'] as number,
    tenure: terms['tenureMonths']!['value'] as number,
    emi: terms['statedEmi']!['amount'] as number,
    principal,
    prepay: (terms['prepaymentCharges']!['percent'] as number | null) ?? (terms['prepaymentCharges']!['amount'] as number),
    bounce: pct(terms['bounceCharges']!),
    ear: computed['effectiveAnnualRatePercent']!,
    'interest-total': computed['totalInterest']!,
  };
  const key = q.id.split('/')[1]!;
  const value = byId[key];
  if (value === undefined) throw new Error(`no expected value for ${q.id}`);
  return { type: 'numeric', value, ...(q.expect.tolerance !== undefined ? { tolerance: q.expect.tolerance } : {}) };
}
