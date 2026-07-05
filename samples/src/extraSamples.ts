import type { Block } from './render.js';

export interface ExtraSample {
  slug: string;
  title: string;
  shortTitle: string;
  kind: 'contract' | 'general';
  blocks: Block[];
  // fictional identifiers present in the text, for masking tests
  pii: Record<string, string>;
  truth: Record<string, unknown>;
}

const P = (text: string, tag?: string): Block => ({ kind: 'para', text, ...(tag ? { tag } : {}) });
const H = (text: string, tag?: string): Block => ({ kind: 'heading', text, ...(tag ? { tag } : {}) });
const KV = (key: string, value: string, tag?: string): Block => ({ kind: 'kv', key, value, ...(tag ? { tag } : {}) });

// --- Residential lease: a contract with lock-in, deposit forfeiture, auto-renewal and one-sided clauses ---

const TENANT = { name: 'Kabir Malhotra', pan: 'FKRPM3391Q', phone: '+91 99870 12345', email: 'kabir.malhotra.demo@example.com', account: '20987654321', ifsc: 'HDFC0000412' };

export const rentalAgreement: ExtraSample = {
  slug: 'residential-lease',
  title: 'Residential Leave and Licence Agreement',
  shortTitle: 'Residential lease',
  kind: 'contract',
  pii: TENANT,
  blocks: [
    { kind: 'title', text: 'LEAVE AND LICENCE AGREEMENT' },
    P(`This Leave and Licence Agreement ("Agreement") is made at Pune on 1 August 2026 between Mrs. Sunita Deshpande, residing at 42 Prabhat Road, Pune 411004 (the "Licensor"), and ${TENANT.name}, holding PAN ${TENANT.pan}, contactable at ${TENANT.phone} and ${TENANT.email} (the "Licensee").`, 'parties'),
    P(`WHEREAS the Licensor is the owner of Flat 7B, Sarovar Residency, Baner, Pune 411045 (the "Premises") and has agreed to grant the Licensee a licence to occupy the Premises for residential use on the terms below.`),
    H('1. Term', 'term'),
    P(`The licence shall commence on 1 August 2026 and remain in force for a period of 24 months, ending on 31 July 2028, unless terminated earlier in accordance with this Agreement.`, 'term'),
    P(`This Agreement shall automatically renew for a further period of 12 months on the same terms, with the Licence Fee increased by 10%, unless either party gives written notice of non-renewal at least 90 days before the expiry of the then-current term.`, 'risk:auto_renewal'),
    H('2. Licence Fee and Deposit', 'payment'),
    P(`The Licensee shall pay a monthly licence fee of Rs. 38,000 (Rupees Thirty-Eight Thousand only) in advance on or before the 5th day of each month by electronic transfer to the Licensor's account. Maintenance charges levied by the housing society shall be paid by the Licensee in addition to the Licence Fee.`, 'payment'),
    P(`The Licensee has paid an interest-free security deposit of Rs. 2,28,000 (six months' Licence Fee) (the "Deposit"), receipt of which the Licensor acknowledges. The Deposit shall be refunded within 60 days of the Licensee vacating the Premises, after deduction of unpaid fees, repair costs and any other amounts due.`, 'deposit'),
    P(`If the Licensee vacates the Premises before the expiry of the Lock-in Period, the entire Deposit shall stand forfeited to the Licensor as liquidated damages, without prejudice to the Licensor's other rights.`, 'risk:deposit_forfeiture'),
    P(`Any Licence Fee not paid within 7 days of its due date shall attract interest at 2% per month, compounded monthly, until payment.`, 'risk:penal_interest'),
    H('3. Lock-in Period', 'lockin'),
    P(`The first 12 months of the term shall be a lock-in period (the "Lock-in Period"). The Licensee shall not terminate this Agreement during the Lock-in Period; if the Licensee does so or abandons the Premises, the Licensee shall pay the Licence Fee for the unexpired portion of the Lock-in Period in addition to forfeiting the Deposit.`, 'risk:lock_in'),
    H('4. Use of Premises'),
    P(`The Premises shall be used solely for the residence of the Licensee and immediate family. The Licensee shall not sublet, assign or part with possession, carry on any business, keep pets, or make structural alterations without the Licensor's prior written consent.`),
    P(`The Licensee shall permit the Licensor or her agents to inspect the Premises at any reasonable time on 24 hours' notice, and at any time without notice in an emergency.`),
    H('5. Repairs and Maintenance'),
    P(`The Licensee shall keep the interior of the Premises, fixtures and fittings in good condition and bear the cost of minor repairs up to Rs. 3,000 per instance. Structural repairs and major repairs to plumbing and electrical systems shall be borne by the Licensor, provided the damage was not caused by the Licensee.`),
    H('6. Termination', 'termination'),
    P(`After the Lock-in Period, either party may terminate this Agreement by giving the other not less than 60 days' written notice.`, 'notice'),
    P(`Notwithstanding the above, the Licensor may terminate this Agreement at any time by giving 15 days' notice if the Licensor requires the Premises for personal use, or immediately and without notice on any breach by the Licensee, and may re-enter the Premises and remove the Licensee's belongings. The Licensee shall have no corresponding right of early termination.`, 'risk:one_sided_termination'),
    P(`On termination the Licensee shall hand over vacant possession of the Premises in the condition received, fair wear and tear excepted, and settle all outstanding utility bills.`),
    H('7. Amendments'),
    P(`The Licensor may revise the house rules, the maintenance charges payable and the schedule of permitted uses from time to time by written notice, and such revisions shall bind the Licensee from the date of the notice without any requirement of consent.`, 'risk:unilateral_amendment'),
    H('8. Indemnity'),
    P(`The Licensee shall indemnify and hold harmless the Licensor against all claims, losses, damages, costs and expenses of whatever nature arising directly or indirectly from the Licensee's occupation of the Premises, including claims by third parties and the housing society, whether or not caused by the Licensee's negligence.`, 'risk:broad_indemnity'),
    H('9. Registration and Stamp Duty'),
    P(`This Agreement shall be registered with the Sub-Registrar of Assurances, Pune. Stamp duty and registration charges shall be shared equally by the parties.`),
    H('10. Dispute Resolution and Governing Law', 'law'),
    P(`This Agreement is governed by the laws of India. Any dispute shall be referred to the sole arbitration of an arbitrator nominated by the Licensor under the Arbitration and Conciliation Act, 1996, with the seat of arbitration at Pune.`, 'risk:arbitration'),
    H('11. Notices'),
    P(`Notices to the Licensee shall be sent to ${TENANT.email} or ${TENANT.phone}; refunds of the Deposit shall be made to account number ${TENANT.account}, IFSC ${TENANT.ifsc}.`),
    H('Schedule - Summary of Terms', 'schedule'),
    KV('Premises', 'Flat 7B, Sarovar Residency, Baner, Pune 411045'),
    KV('Term', '24 months from 1 August 2026', 'term'),
    KV('Lock-in period', '12 months', 'lockin'),
    KV('Licence fee', 'Rs. 38,000 per month, payable by the 5th', 'payment'),
    KV('Security deposit', 'Rs. 2,28,000, refundable within 60 days of vacating', 'deposit'),
    KV('Notice period after lock-in', '60 days by either party', 'notice'),
    KV('Renewal', 'Automatic for 12 months at +10% unless 90 days notice', 'renewal'),
    { kind: 'spacer' },
    P(`IN WITNESS WHEREOF the parties have signed this Agreement on the date first written above. Licensor: Sunita Deshpande. Licensee: ${TENANT.name}.`),
  ],
  truth: {
    facts: {
      documentType: 'Leave and Licence Agreement',
      parties: ['Sunita Deshpande', TENANT.name],
      effectiveDate: '1 August 2026',
      term: '24 months',
      paymentObligations: 'Rs. 38,000 per month',
      securityDeposit: 'Rs. 2,28,000',
      noticePeriod: '60 days',
      renewal: 'automatic 12 months, +10%, unless 90 days notice',
      governingLaw: 'India, arbitration at Pune',
    },
    risks: ['auto_renewal', 'deposit_forfeiture', 'penal_interest', 'lock_in', 'one_sided_termination', 'unilateral_amendment', 'broad_indemnity', 'arbitration'],
    absentRisks: ['non_compete', 'liability_limitation', 'broad_data_sharing', 'cross_default', 'security_interest', 'auto_debit_mandate', 'unilateral_rate_change'],
  },
};

// --- Class notes: not an agreement at all; the app should answer questions and outline it ---

export const lectureNotes: ExtraSample = {
  slug: 'lecture-notes-tvm',
  title: 'Lecture Notes: Time Value of Money and Loan Amortisation',
  shortTitle: 'Lecture notes (finance)',
  kind: 'general',
  pii: {},
  blocks: [
    { kind: 'title', text: 'FIN 201 - LECTURE 6: TIME VALUE OF MONEY AND LOAN AMORTISATION' },
    P('These notes accompany the sixth lecture of the introductory corporate finance course. They cover discounting, annuities, the construction of a loan amortisation schedule, and the difference between nominal and effective interest rates. Worked examples use Indian rupee amounts.'),
    H('1. Why money has a time value'),
    P('A rupee today is worth more than a rupee next year because it can be invested to earn a return, because prices rise, and because the future is uncertain. The interest rate is the exchange rate between money now and money later. Discounting converts a future amount into its present value; compounding does the reverse.'),
    P('The present value of a single amount F received after n periods at a periodic rate r is PV = F / (1 + r)^n. The factor 1 / (1 + r)^n is called the discount factor. As either r or n increases, the discount factor falls.'),
    H('2. Annuities'),
    P('An annuity is a level stream of payments at regular intervals. The present value of an ordinary annuity of C per period for n periods is PV = C x [1 - (1 + r)^-n] / r. This formula is derived by summing a geometric series of discount factors. An annuity due pays at the start of each period and is worth (1 + r) times an ordinary annuity.'),
    P('Worked example: a scholarship pays Rs. 10,000 at the end of each year for 5 years and the discount rate is 8%. PV = 10,000 x [1 - 1.08^-5] / 0.08 = 10,000 x 3.9927 = Rs. 39,927.'),
    H('3. The EMI formula'),
    P('A loan repaid in equal monthly instalments is an annuity in reverse: the lender gives the borrower the present value today and receives the level payments. Rearranging the annuity formula gives the instalment: EMI = P x r x (1 + r)^n / [(1 + r)^n - 1], where P is the principal, r the monthly rate (annual rate divided by 12) and n the number of months.'),
    P('Worked example: P = Rs. 10,00,000, annual rate 10%, n = 60. Then r = 0.008333, (1 + r)^60 = 1.6453, and EMI = 10,00,000 x 0.008333 x 1.6453 / 0.6453 = Rs. 21,247. Total repayment is 60 x 21,247 = Rs. 12,74,820, so total interest is about Rs. 2,74,820.'),
    H('4. Building an amortisation schedule'),
    P('Each instalment is split into interest and principal. Interest for the month equals the opening balance times r; the principal component is the EMI minus that interest; the closing balance is the opening balance minus the principal component. Early instalments are mostly interest, later ones mostly principal. A spreadsheet with five columns - month, opening balance, interest, principal, closing balance - reproduces the whole schedule, and the closing balance after the final month should be zero.'),
    P('Common student error: computing interest on the original principal every month. That is the flat-rate method used by some lenders, and it overstates interest by roughly 45 to 50 percent for a five-year loan compared with the reducing-balance method.'),
    H('5. Nominal versus effective rates'),
    P('A nominal annual rate of 12% compounded monthly is really 1% per month, and (1.01)^12 - 1 = 12.68% per year. The effective annual rate (EAR) is what the borrower actually pays when compounding is taken into account. When a loan carries upfront fees, the borrower receives less than the principal but repays the full schedule; the internal rate of return of those cash flows is the true cost, and it is always above the nominal rate.'),
    P('Worked example: a fee of 2% on a one-year loan at 12% nominal raises the effective cost to roughly 14.3%, because the borrower receives Rs. 98 for every Rs. 100 repaid with interest.'),
    H('6. Summary and reading'),
    P('Discounting and compounding are inverses. Annuity formulas price level cash-flow streams, and the EMI formula is the annuity formula solved for the payment. Amortisation schedules show how each instalment splits. Effective rates, not nominal rates, are the basis for comparing offers. Read Brealey, Myers and Allen chapter 2 and attempt problems 6.1 to 6.8 before the tutorial.'),
    H('Practice questions'),
    P('Q1. A loan of Rs. 5,00,000 at 9% per annum for 36 months: compute the EMI and the interest in the first month. Q2. Explain why an annuity due is worth more than an ordinary annuity. Q3. A lender advertises 9.5% flat on a 60-month vehicle loan; estimate the reducing-balance equivalent. Q4. Why does a processing fee raise the effective rate more on a short loan than on a long one?'),
  ],
  truth: {
    outlineHeadings: ['Why money has a time value', 'Annuities', 'The EMI formula', 'Building an amortisation schedule', 'Nominal versus effective rates', 'Summary and reading', 'Practice questions'],
    facts: { scholarshipPv: 39927, exampleEmi: 21247, nominalToEar: '12% monthly -> 12.68%' },
  },
};

export const EXTRA_SAMPLES: ExtraSample[] = [rentalAgreement, lectureNotes];
