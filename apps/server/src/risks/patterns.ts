import type { RiskCategory } from '@docsense/shared';

export interface RiskPattern {
  category: RiskCategory;
  label: string;
  // what the reviewer is asked to confirm; keeps the model focused on the actual borrower harm
  question: string;
  patterns: RegExp[];
}

// Deterministic pre-filter. It only has to be high-recall: the model confirms or rejects each candidate.
export const RISK_PATTERNS: RiskPattern[] = [
  {
    category: 'auto_debit_mandate',
    label: 'Auto-debit mandate',
    question: 'Must the borrower give an auto-debit/NACH/standing-instruction mandate that they cannot freely cancel, or that the lender may present repeatedly?',
    patterns: [/\bNACH\b/i, /auto[- ]?debit/i, /standing instruction/i, /\bmandate\b[^.]{0,160}\b(cancel|revoke|suspend|vary|present)/i],
  },
  {
    category: 'penal_interest',
    label: 'Penal interest / compounding default charges',
    question: 'Are penal or default charges compounded, capitalised into principal, or charged on top of contracted interest in a way that escalates the debt?',
    patterns: [/penal (interest|charge)/i, /default interest/i, /overdue interest/i, /additional interest/i, /compound(ed|ing)?[^.]{0,80}(penal|default|overdue)/i, /capitalis(e|ed|ation)/i],
  },
  {
    category: 'unilateral_rate_change',
    label: 'Unilateral change of rate or charges',
    question: 'Can the lender change the interest rate, spread, fees or charges at its sole discretion without prior notice or the borrower\'s consent?',
    patterns: [
      /(sole|absolute) discretion[^.]{0,160}(rate|interest|spread|fee|charge)/i,
      /without (prior |any )?(notice|intimation)[^.]{0,120}(revis|chang|vary|alter|modif)[^.]{0,80}(rate|interest|fee|charge|spread)/i,
      /(revis|chang|vary|alter)[^.]{0,80}(rate|interest|spread|fee|charge)[^.]{0,120}(without (prior |any )?notice|sole discretion)/i,
      /waive[s]? any right to object/i,
    ],
  },
  {
    category: 'broad_data_sharing',
    label: 'Broad data-sharing consent',
    question: 'Does the borrower consent to their personal or financial data being shared with affiliates, partners, marketers or any third party for purposes beyond servicing this loan (e.g. cross-selling)?',
    patterns: [
      /(shar|disclos|transfer)[^.]{0,200}(group compan|affiliate|business partner|marketing|any third part|any person|service provider)/i,
      /cross[- ]sell/i,
      /irrevocabl[ey] consent[^.]{0,120}(information|data)/i,
      /survive[^.]{0,60}termination[^.]{0,80}(consent|information|data)/i,
    ],
  },
  {
    category: 'one_sided_termination',
    label: 'One-sided termination or recall',
    question: 'Can the lender terminate, recall the loan or repossess without reason or notice while the borrower has no equivalent right?',
    patterns: [
      /(terminat|recall)[^.]{0,160}(without (assigning any )?reason|without (prior |any )?notice|at any time)/i,
      /(take possession|repossess)/i,
      /no corresponding right/i,
    ],
  },
  {
    category: 'arbitration',
    label: 'Lender-controlled arbitration',
    question: 'Are disputes sent to arbitration, especially with an arbitrator appointed by the lender or a seat chosen by the lender?',
    patterns: [/\barbitrat/i],
  },
  {
    category: 'cross_default',
    label: 'Cross-default',
    question: 'Does a default under any other agreement (with the lender, its affiliates, or by a guarantor/group entity) trigger default on this loan?',
    patterns: [/cross[- ]default/i, /default under any other (agreement|facility|loan)/i, /event of default under any other/i, /(guarantor|group entit)[^.]{0,120}(default)/i],
  },
  {
    category: 'security_interest',
    label: 'Security interest over assets',
    question: 'Does the borrower create a charge, hypothecation, mortgage, pledge or lien over an asset, with restrictions on selling or encumbering it?',
    patterns: [/hypothecat/i, /mortgage/i, /charge in favour of/i, /\bpledge\b/i, /\blien\b/i, /first and exclusive charge/i],
  },
];
