import type { DocumentKind } from '@docsense/shared';

// Keyword-density classifier: no model call, deterministic, unit-tested on the sample corpus.
// Loan signals are specific to credit; contract signals are shared by every kind of agreement.
const LOAN_SIGNALS = [
  /\bloan\b/g,
  /\bborrower\b/g,
  /\blender\b/g,
  /\bemi\b/gi,
  /\bequated monthly/g,
  /\binterest rate\b|\brate of interest\b/g,
  /\btenure\b/g,
  /\bprepay(?:ment)?\b|\bforeclos/g,
  /\bdisburs/g,
  /\bsanction/g,
  /\brepayment\b/g,
  /\bprincipal\b/g,
  /\bprocessing fee\b/g,
];

const CONTRACT_SIGNALS = [
  /\bagreement\b/g,
  /\bpart(?:y|ies)\b/g,
  /\bhereinafter\b/g,
  /\bwhereas\b/g,
  /\bterminat/g,
  /\bindemnif/g,
  /\bgoverning law\b|\bjurisdiction\b/g,
  /\blessor\b|\blessee\b|\blandlord\b|\btenant\b|\blicensor\b|\blicensee\b/g,
  /\bemployer\b|\bemployee\b|\bcontractor\b|\bservice provider\b/g,
  /\bshall\b/g,
  /\bnotice\b/g,
  /\bdeposit\b|\brent\b|\bconsideration\b|\bfees?\b/g,
  /\bconfidential/g,
];

export interface Classification {
  kind: DocumentKind;
  // hits per 1,000 words, so long documents are not favoured
  loanDensity: number;
  contractDensity: number;
  // how many distinct loan signals appear at all
  loanSignals: number;
}

function score(text: string, patterns: RegExp[], words: number): { density: number; distinct: number } {
  let hits = 0;
  let distinct = 0;
  for (const p of patterns) {
    const n = (text.match(p) ?? []).length;
    hits += n;
    if (n > 0) distinct += 1;
  }
  return { density: (hits / Math.max(words, 1)) * 1000, distinct };
}

// A loan agreement is first an agreement: notes *about* loans score high on loan words but have no
// parties, no "whereas", no termination clause, so the agreement gate keeps them general.
export function classifyDocument(text: string): Classification {
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean).length;
  const loan = score(lower, LOAN_SIGNALS, words);
  const contract = score(lower, CONTRACT_SIGNALS, words);
  const isAgreement = contract.density >= 10 && contract.distinct >= 4;
  let kind: DocumentKind = 'general';
  if (isAgreement) kind = loan.density >= 12 && loan.distinct >= 5 ? 'loan' : 'contract';
  return {
    kind,
    loanDensity: Math.round(loan.density * 10) / 10,
    contractDensity: Math.round(contract.density * 10) / 10,
    loanSignals: loan.distinct,
  };
}
