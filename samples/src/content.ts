import { emiFlat, emiReducing, round2 } from '@docsense/shared';
import type { Block } from './render.js';
import type { Fee, HeadingStyle, SampleSpec } from './spec.js';

export function formatINR(n: number): string {
  const [whole, frac] = n.toFixed(n % 1 === 0 ? 0 : 2).split('.');
  const w = whole!;
  const last3 = w.slice(-3);
  const rest = w.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return frac ? `${grouped}.${frac}` : grouped;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV'];

function heading(style: HeadingStyle, n: number, title: string): string {
  switch (style) {
    case 'numbered':
      return `${n}. ${title.toUpperCase()}`;
    case 'article':
      return `ARTICLE ${ROMAN[n - 1]} - ${title.toUpperCase()}`;
    case 'clause':
      return `Clause ${n}. ${title}`;
    case 'kfs':
      return `SECTION ${String.fromCharCode(64 + n)}: ${title.toUpperCase()}`;
    case 'schedule':
      return `${n}. ${title}`;
  }
}

function sub(style: HeadingStyle, n: number, m: number, title: string): string {
  return style === 'clause' ? `${n}.${m} ${title}` : `${n}.${m} ${title}`;
}

export function statedEmi(spec: SampleSpec): number {
  const emi = spec.method === 'flat'
    ? emiFlat(spec.principal, spec.annualRate, spec.tenureMonths)
    : emiReducing(spec.principal, spec.annualRate, spec.tenureMonths);
  return round2(emi);
}

function feeText(fee: Fee, base: number): string {
  if (fee.percent !== null && fee.percent > 0) {
    const amt = round2((base * fee.percent) / 100);
    return `${fee.percent}% (Rs. ${formatINR(amt)})`;
  }
  if (fee.amount !== null && fee.amount > 0) return `Rs. ${formatINR(fee.amount)}`;
  return 'Nil';
}

export function buildBlocks(spec: SampleSpec): Block[] {
  const b = spec.borrower;
  const emi = statedEmi(spec);
  const s = spec.style;
  const blocks: Block[] = [];
  const has = (r: SampleSpec['risks'][number]) => spec.risks.includes(r);
  let n = 0;
  const H = (title: string, tag?: string) => {
    n += 1;
    blocks.push({ kind: 'heading', text: heading(s, n, title), ...(tag ? { tag } : {}) });
  };
  const S = (m: number, title: string, tag?: string) =>
    blocks.push({ kind: 'heading', text: sub(s, n, m, title), ...(tag ? { tag } : {}) });
  const P = (text: string, tag?: string) => blocks.push({ kind: 'para', text, ...(tag ? { tag } : {}) });
  const KV = (key: string, value: string, tag?: string) => blocks.push({ kind: 'kv', key, value, ...(tag ? { tag } : {}) });

  blocks.push({ kind: 'title', text: `${spec.title.toUpperCase()}` });
  P(`This ${spec.title} ("Agreement") is executed at ${spec.place} on ${spec.agreementDate} between ${spec.lender}, a company incorporated under the Companies Act, 2013 and registered with the Reserve Bank of India, having its registered office at Tower 3, Nariman Point, Mumbai 400021 (hereinafter the "Lender", which expression shall include its successors and assigns) of the ONE PART;`, 'lenderName');
  P(`AND ${b.name}, an individual residing at ${b.address}, holding Permanent Account Number ${b.pan} and Aadhaar number ${b.aadhaar}, contactable at ${b.phone} and ${b.email} (hereinafter the "Borrower") of the OTHER PART.`, 'borrower');
  P(`WHEREAS the Borrower has applied to the Lender for a ${spec.loanType} and the Lender has agreed to grant the facility on the terms and conditions set out in this Agreement, the Sanction Letter and the Key Facts Statement, each of which forms an integral part of this Agreement.`);

  if (s === 'kfs') {
    H('Key Facts', 'kfs');
    KV('Lender', spec.lender, 'lenderName');
    KV('Borrower', b.name);
    KV('Loan amount sanctioned', `Rs. ${formatINR(spec.principal)} (${spec.principalWords})`, 'principal');
    KV('Rate of interest', `${spec.annualRate}% per annum, ${spec.rateType}, on a ${spec.method} balance basis`, 'interestRate');
    KV('Tenure', `${spec.tenureMonths} months`, 'tenureMonths');
    KV('Equated Monthly Instalment (EMI)', `Rs. ${formatINR(emi)}`, 'statedEmi');
    KV('Processing fee', feeText(spec.processingFee, spec.principal), 'processingFee');
    KV('Insurance premium', feeText(spec.insurancePremium, spec.principal), 'insurancePremium');
    spec.otherUpfrontCharges.forEach((f, i) => KV(f.description, feeText(f, spec.principal), `otherUpfront:${i}`));
    KV('Prepayment / foreclosure charges', spec.prepaymentCharges.description, 'prepaymentCharges');
    KV('Penal charges on overdue amounts', spec.latePaymentCharges.description, 'latePaymentCharges');
    KV('Cheque / mandate bounce charges', spec.bounceCharges.description, 'bounceCharges');
    KV('Cooling-off period', '3 working days from disbursement, during which the loan may be returned without penalty');
  }

  H('Definitions');
  P('"Business Day" means a day, other than a Saturday, Sunday or public holiday, on which banks are open for business in the place of disbursement.');
  P('"Due Date" means the date on which any EMI or other amount becomes payable under this Agreement, being the 5th day of each calendar month unless otherwise notified.');
  P('"EMI" or "Equated Monthly Instalment" means the amount payable every month comprising principal and interest, calculated so as to amortise the Loan over the Tenure.');
  P('"Loan" means the principal amount sanctioned under this Agreement, or so much of it as is outstanding from time to time, together with interest, fees, charges and costs.');
  P('"Outstanding Dues" means the aggregate of the principal outstanding, accrued interest, penal charges, fees and any other sum payable by the Borrower.');

  H('The Loan', 'principal');
  P(`Subject to the terms of this Agreement, the Lender agrees to lend and the Borrower agrees to borrow a sum of Rs. ${formatINR(spec.principal)} (${spec.principalWords}) (the "Loan Amount"). The Loan shall be disbursed in a single tranche to account number ${b.account} held with ${b.ifsc.slice(0, 4)} Bank, IFSC ${b.ifsc}, after deduction of the fees and charges described in this Agreement.`, 'principal');
  P(`The Borrower shall use the Loan solely for the purpose stated in the application form. Any diversion of funds shall constitute an Event of Default.`);
  if (s === 'schedule') {
    P(`The particulars of the Loan are set out in Schedule I to this Agreement, which the Borrower confirms having read and understood.`);
  }

  H('Interest', 'interestRate');
  if (spec.rateType === 'fixed') {
    P(`Interest shall accrue on the Loan at a fixed rate of ${spec.annualRate}% per annum, calculated on a ${spec.method === 'flat' ? 'flat rate basis on the original Loan Amount for the entire Tenure' : 'monthly reducing balance basis'}. ${spec.method === 'flat' ? 'For the avoidance of doubt, interest is not recalculated on the reducing principal and the annualised effective rate is therefore higher than the flat rate stated above.' : 'Interest is computed on the principal outstanding at the beginning of each month.'}`, 'interestRate');
  } else {
    P(`Interest shall accrue on the Loan at a floating rate, presently ${spec.annualRate}% per annum, being ${spec.benchmark}, calculated on a monthly reducing balance basis. The applicable rate shall be reset whenever the benchmark changes.`, 'interestRate');
  }
  if (has('unilateral_rate_change')) {
    P(`The Lender may, at its sole discretion and without prior notice to the Borrower, revise the rate of interest, the spread over the benchmark, or any fee or charge, and such revision shall bind the Borrower from the date recorded in the Lender's books. The Borrower waives any right to object to such revision.`, 'risk:unilateral_rate_change');
  } else {
    P(`Any change in the rate of interest shall be communicated to the Borrower in writing at least 30 days before it takes effect, and the Borrower may, within that period, prepay the Loan without charge.`);
  }
  P(`Interest shall be computed on the basis of a 365-day year and the actual number of days elapsed. All amounts payable are exclusive of applicable taxes, which shall be borne by the Borrower.`);

  H('Repayment', 'tenureMonths');
  P(`The Borrower shall repay the Loan together with interest in ${spec.tenureMonths} equated monthly instalments of Rs. ${formatINR(emi)} each, the first instalment falling due one month after the date of disbursement.`, 'statedEmi');
  P(`The Tenure of the Loan is ${spec.tenureMonths} months from the date of first disbursement. The EMI has been computed on the assumption that the Loan is disbursed in full on the disbursement date${spec.rateType === 'floating' ? ' and at the rate of interest prevailing on that date; a change in the floating rate shall, at the Lender\'s option, alter the EMI or the number of instalments' : ''}.`, 'tenureMonths');
  if (has('auto_debit_mandate')) {
    P(`The Borrower shall execute a National Automated Clearing House (NACH) mandate or standing instruction in favour of the Lender authorising the debit of each EMI and all other amounts due from the Borrower's account ${b.account}. The Borrower shall not cancel, suspend or vary the mandate without the Lender's prior written consent, and the Lender may present the mandate any number of times until the amount is realised.`, 'risk:auto_debit_mandate');
  } else {
    P(`The Borrower may pay each EMI by electronic transfer, standing instruction or any other mode acceptable to the Lender. Where a standing instruction is given, the Borrower may cancel it on 15 days' notice provided an alternative mode of payment is put in place.`);
  }
  P(`Payments shall be appropriated first towards costs and charges, then towards penal charges, then towards interest, and lastly towards principal, unless the Lender determines otherwise.`);

  H('Conditions Precedent to Disbursement');
  P(`The Lender's obligation to disburse the Loan is subject to the Borrower having (a) executed this Agreement and all security and mandate documents in the form required by the Lender; (b) furnished proof of identity, address and income satisfactory to the Lender; (c) paid or authorised deduction of all fees and charges due at disbursement; and (d) satisfied such other conditions as may be stated in the Sanction Letter.`);
  P(`The Lender may waive any condition precedent at its discretion, and such waiver shall not prejudice the Lender's right to insist on compliance with that condition at a later date.`);

  H('Representations and Warranties');
  P(`The Borrower represents and warrants that: (a) the Borrower is a citizen of India, of sound mind and competent to contract; (b) all information provided in the application form and supporting documents is true, complete and not misleading; (c) the Borrower is not in default under any other borrowing; (d) no insolvency, bankruptcy or similar proceeding is pending or threatened against the Borrower; and (e) the execution of this Agreement does not conflict with any law, order or agreement binding on the Borrower.`);
  P(`Each representation is deemed repeated on every Due Date by reference to the facts then existing. The Borrower shall notify the Lender within 7 days of any change in employment, income, residential address or contact details.`);

  H('Covenants of the Borrower');
  P(`For so long as any amount remains outstanding, the Borrower shall: (a) pay every EMI and other amount on its Due Date without set-off or counterclaim; (b) maintain sufficient balance in the designated account to honour each mandate; (c) provide the Lender with such financial and other information as it may reasonably request; (d) not obtain any other credit facility that would impair the Borrower's ability to service the Loan; and (e) comply with all applicable laws including the Prevention of Money Laundering Act, 2002.`);
  P(`The Borrower shall promptly inform the Lender of any litigation, attachment or garnishee order affecting the Borrower's assets or income.`);

  H('Fees and Charges', 'fees');
  S(1, 'Processing Fee', 'processingFee');
  P(`${spec.processingFee.percent === 0 && spec.processingFee.amount === 0 ? 'No processing fee is payable on this Loan.' : `The Borrower shall pay a non-refundable processing fee of ${feeText(spec.processingFee, spec.principal)}. ${spec.processingFee.description}. The processing fee shall be deducted from the disbursement amount.`}`, 'processingFee');
  S(2, 'Insurance', 'insurancePremium');
  P(`${spec.insurancePremium.amount === null && spec.insurancePremium.percent === null ? spec.insurancePremium.description + '.' : `${spec.insurancePremium.description} of Rs. ${formatINR(spec.insurancePremium.amount ?? 0)} shall be payable upfront and deducted from the disbursement. The Borrower may opt for a policy from any insurer of choice provided the Lender is named as beneficiary.`}`, 'insurancePremium');
  if (spec.otherUpfrontCharges.length) {
    S(3, 'Other Upfront Charges', 'otherUpfront');
    spec.otherUpfrontCharges.forEach((f, i) => P(`${f.description}: ${feeText(f, spec.principal)}, payable at the time of disbursement.`, `otherUpfront:${i}`));
  }

  H('Prepayment and Foreclosure', 'prepaymentCharges');
  P(`${spec.prepaymentCharges.percent === 0 ? `The Borrower may prepay the Loan in full or in part at any time. ${spec.prepaymentCharges.description}.` : `The Borrower may prepay or foreclose the Loan subject to payment of a prepayment charge of ${spec.prepaymentCharges.percent}% ${spec.prepaymentCharges.description.includes('outstanding') ? 'of the principal outstanding' : 'of the amount prepaid'} plus applicable taxes. ${spec.prepaymentCharges.description}.`} Part prepayments shall be applied to reduce the principal outstanding and, at the Lender's option, either the EMI or the remaining Tenure.`, 'prepaymentCharges');

  H('Default and Penal Charges', 'latePaymentCharges');
  P(`If any EMI or other amount is not paid on the Due Date, the Borrower shall pay ${spec.latePaymentCharges.description.charAt(0).toLowerCase() + spec.latePaymentCharges.description.slice(1)}, computed from the Due Date until the date of actual payment, in addition to the contracted interest.`, 'latePaymentCharges');
  if (has('penal_interest')) {
    P(`Penal charges shall be compounded monthly and capitalised to the principal outstanding, and the Lender may further charge default interest on the capitalised amount at the contracted rate.`, 'risk:penal_interest');
  }
  P(`${spec.bounceCharges.description} shall be payable, in addition to any charges levied by the Borrower's bank, whenever a cheque, NACH mandate or standing instruction is dishonoured for any reason.`, 'bounceCharges');
  if (has('cross_default')) {
    P(`An Event of Default under any other agreement between the Borrower (or any group entity or guarantor) and the Lender or any of its affiliates shall constitute an Event of Default under this Agreement, entitling the Lender to recall the Loan forthwith.`, 'risk:cross_default');
  }
  if (has('one_sided_termination')) {
    P(`The Lender may at any time, without assigning any reason and without notice, terminate this Agreement, recall the Loan and take possession of the hypothecated asset, whereupon the Outstanding Dues shall become immediately payable. The Borrower shall have no corresponding right to terminate except by repayment of all Outstanding Dues.`, 'risk:one_sided_termination');
  } else {
    P(`On the occurrence of an Event of Default the Lender shall give the Borrower a written notice of not less than 15 days to cure the default before recalling the Loan.`);
  }

  H('Events of Default');
  P(`Each of the following is an Event of Default: (a) failure to pay any EMI or other amount within 3 days of its Due Date; (b) breach of any covenant, representation or warranty; (c) any information furnished by the Borrower proving false or misleading; (d) the Borrower becoming insolvent, or an application for insolvency being filed; (e) any security becoming unenforceable or, in the Lender's opinion, inadequate; (f) death or incapacity of the Borrower without adequate arrangement for repayment; and (g) any event which in the Lender's reasonable opinion is likely to prejudice the Borrower's ability to repay.`);
  P(`On an Event of Default the Lender may, in addition to any other remedy, declare all Outstanding Dues immediately payable, enforce any security, report the default to credit information companies, and engage recovery agents in accordance with the Lender's Fair Practices Code.`);

  if (has('security_interest')) {
    H('Security', 'risk:security_interest');
    P(`As security for the Loan the Borrower hereby creates a first and exclusive charge in favour of the Lender over the ${spec.loanType === 'vehicle loan' ? 'vehicle described in the Schedule, by way of hypothecation' : 'property described in the Schedule, by way of registered mortgage'}, together with all future receivables and insurance proceeds relating to it. The Borrower shall not sell, transfer, lease or further encumber the security without the Lender's prior written consent.`, 'risk:security_interest');
  }

  H('Information and Data Sharing', 'data');
  if (has('broad_data_sharing')) {
    P(`The Borrower irrevocably consents to the Lender collecting, storing, using and disclosing any information relating to the Borrower, including personal, financial and transaction data, to its group companies, business partners, marketing affiliates, service providers and any third party the Lender deems fit, for any purpose including cross-selling of products, without any further notice or consent, and this consent shall survive termination of this Agreement.`, 'risk:broad_data_sharing');
  } else {
    P(`The Lender shall keep the Borrower's information confidential and shall disclose it only to credit information companies as required by law, to regulators, and to service providers bound by confidentiality obligations, solely for purposes connected with this Loan.`);
  }
  P(`The Borrower authorises the Lender to report the conduct of the Loan account to credit information companies registered with the Reserve Bank of India.`);

  H('Dispute Resolution', 'dispute');
  if (has('arbitration')) {
    P(`Any dispute arising out of or in connection with this Agreement shall be referred to the sole arbitration of an arbitrator appointed by the Lender, under the Arbitration and Conciliation Act, 1996. The seat of arbitration shall be ${spec.place} and the proceedings shall be conducted in English. The Borrower waives any objection to the appointment of the arbitrator by the Lender.`, 'risk:arbitration');
  } else {
    P(`This Agreement shall be governed by the laws of India and the courts at ${spec.place} shall have exclusive jurisdiction over any dispute arising out of it. Nothing in this clause prevents the Borrower from approaching the Banking Ombudsman.`);
  }

  H('Assignment and Transfer');
  P(`The Lender may assign, securitise or transfer all or any of its rights and obligations under this Agreement to any person without the consent of the Borrower, and the Borrower shall, on notice, make all payments to such assignee. The Borrower shall not assign or transfer any of the Borrower's rights or obligations under this Agreement.`);

  H('Costs, Expenses and Indemnity');
  P(`The Borrower shall bear all stamp duty, registration fees, legal costs and collection expenses incurred by the Lender in connection with this Agreement, its enforcement and the recovery of Outstanding Dues. The Borrower shall indemnify the Lender against all losses, claims and expenses arising from any breach by the Borrower or from any inaccuracy in the information furnished by the Borrower.`);

  H('Grievance Redressal');
  P(`The Borrower may lodge a complaint with the Lender's Grievance Redressal Officer by e-mail to grievance@${spec.lenderShort.toLowerCase()}-demo.example.com or in writing to the registered office. If the complaint is not resolved within 30 days, the Borrower may approach the Reserve Bank of India's Integrated Ombudsman Scheme. The Lender's Fair Practices Code is available on its website and at every branch.`);

  H('General');
  P(`This Agreement, together with the Sanction Letter and the Key Facts Statement, constitutes the entire agreement between the parties. No amendment shall be effective unless in writing and signed by both parties, save as expressly provided herein.`);
  P(`Notices to the Borrower shall be sent to the address, mobile number ${b.phone} or e-mail ${b.email} stated above, and shall be deemed received two Business Days after despatch.`);
  P(`If any provision of this Agreement is held invalid, the remaining provisions shall continue in full force and effect.`);

  H(s === 'schedule' ? 'Schedule I - Particulars of the Loan' : 'Schedule of Charges', 'schedule');
  KV('Loan amount', `Rs. ${formatINR(spec.principal)}`, 'principal');
  KV('Rate of interest', `${spec.annualRate}% p.a. (${spec.rateType}, ${spec.method} balance)${spec.benchmark ? `, ${spec.benchmark}` : ''}`, 'interestRate');
  KV('Tenure', `${spec.tenureMonths} months`, 'tenureMonths');
  KV('EMI', `Rs. ${formatINR(emi)}`, 'statedEmi');
  KV('Processing fee', feeText(spec.processingFee, spec.principal), 'processingFee');
  KV('Insurance premium', feeText(spec.insurancePremium, spec.principal), 'insurancePremium');
  spec.otherUpfrontCharges.forEach((f, i) => KV(f.description, feeText(f, spec.principal), `otherUpfront:${i}`));
  KV('Prepayment charges', spec.prepaymentCharges.percent ? `${spec.prepaymentCharges.percent}%` : 'Nil', 'prepaymentCharges');
  KV('Penal / late payment charges', spec.latePaymentCharges.description, 'latePaymentCharges');
  KV('Bounce charges', `Rs. ${formatINR(spec.bounceCharges.amount ?? 0)}`, 'bounceCharges');
  KV('Repayment account', `${b.account} (IFSC ${b.ifsc})`);

  blocks.push({ kind: 'spacer' });
  P(`IN WITNESS WHEREOF the parties have executed this Agreement on the date first written above.`);
  P(`For ${spec.lender}: Authorised Signatory          Borrower: ${b.name} (PAN ${b.pan})`, 'signature');
  return blocks;
}
