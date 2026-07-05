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
    patterns: [
      /penal (interest|charge)/i,
      /default interest/i,
      /overdue interest/i,
      /additional interest/i,
      /compound(ed|ing)?[^.]{0,80}(penal|default|overdue)/i,
      /capitalis(e|ed|ation)/i,
      /(not paid|unpaid|late|overdue|default)[^.]{0,100}interest at \d/i,
      /interest at \d+(?:\.\d+)?% per month/i,
      /compounded monthly/i,
    ],
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
  {
    category: 'auto_renewal',
    label: 'Automatic renewal',
    question: 'Does the agreement renew automatically unless a party objects within a deadline, especially with a built-in price increase?',
    patterns: [/automatic(?:ally)? renew/i, /\brenew(?:s|ed|al)?\b[^.]{0,120}unless[^.]{0,80}notice/i, /deemed (?:to be )?(?:renewed|extended)/i, /increased by \d+%/i],
  },
  {
    category: 'lock_in',
    label: 'Lock-in period',
    question: 'Is there a lock-in period during which the weaker party cannot exit, or must pay for the unexpired period if they do?',
    patterns: [/lock[- ]in/i, /unexpired (?:portion|period|term)/i, /shall not terminate[^.]{0,80}(?:during|before|within)/i, /minimum (?:term|period|commitment)/i],
  },
  {
    category: 'deposit_forfeiture',
    label: 'Deposit forfeiture',
    question: 'Can a deposit or advance be forfeited in full, or withheld beyond actual costs, or refunded only after a long delay?',
    patterns: [/\bforfeit/i, /deposit[^.]{0,120}(?:retain|withh|deduct)/i, /liquidated damages/i, /refund(?:ed|able)?[^.]{0,80}within \d+ days/i],
  },
  {
    category: 'broad_indemnity',
    label: 'One-sided or unlimited indemnity',
    question: 'Must one party indemnify the other for losses of whatever nature, including third-party claims, regardless of fault?',
    patterns: [/indemnif/i, /hold harmless/i, /whether or not caused by/i, /of whatever nature/i],
  },
  {
    category: 'non_compete',
    label: 'Non-compete or exclusivity',
    question: 'Is a party restricted from working for, dealing with or competing with others during or after the agreement?',
    patterns: [/non[- ]?compet/i, /shall not[^.]{0,80}(?:engage|work|provide services|deal)[^.]{0,80}(?:competitor|competing|any other)/i, /exclusiv(?:e|ity)[^.]{0,80}(?:supplier|provider|dealing)/i, /restraint of trade/i, /solicit[^.]{0,60}(?:employee|client|customer)/i],
  },
  {
    category: 'liability_limitation',
    label: 'Liability cap or exclusion',
    question: "Does the stronger party cap or exclude its own liability (e.g. to fees paid, or excluding consequential loss) while the other party's exposure is uncapped?",
    patterns: [/(?:limit|cap)(?:ed|s)? (?:its |their )?liability/i, /liability[^.]{0,80}(?:shall not exceed|limited to|capped at)/i, /(?:no|not be) liab(?:le|ility)[^.]{0,80}(?:consequential|indirect|loss of profit)/i, /in no event/i],
  },
  {
    category: 'unilateral_amendment',
    label: 'Unilateral changes to terms',
    question: 'Can one party change the rules, charges, scope or terms by notice alone, without the other party\'s consent?',
    patterns: [/(?:revise|amend|modify|change|vary)[^.]{0,120}(?:from time to time|by (?:written )?notice|at its (?:sole )?discretion)/i, /without (?:any )?(?:requirement of )?consent/i, /bind(?:ing|s)?[^.]{0,80}from the date of (?:the |such )?notice/i],
  },
];
