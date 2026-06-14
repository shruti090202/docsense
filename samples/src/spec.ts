import type { RiskCategory } from '@docsense/shared';

export type HeadingStyle = 'numbered' | 'article' | 'clause' | 'kfs' | 'schedule';

export interface Borrower {
  name: string;
  pan: string;
  aadhaar: string;
  phone: string;
  email: string;
  account: string;
  ifsc: string;
  address: string;
}

export interface Fee {
  amount: number | null;
  percent: number | null;
  description: string;
}

export interface SampleSpec {
  slug: string;
  title: string;
  lender: string;
  lenderShort: string;
  loanType: string;
  style: HeadingStyle;
  borrower: Borrower;
  principal: number;
  principalWords: string;
  annualRate: number;
  rateType: 'fixed' | 'floating';
  method: 'reducing' | 'flat';
  benchmark: string | null;
  tenureMonths: number;
  processingFee: Fee;
  insurancePremium: Fee;
  otherUpfrontCharges: Fee[];
  prepaymentCharges: Fee;
  latePaymentCharges: Fee;
  bounceCharges: Fee;
  risks: RiskCategory[];
  agreementDate: string;
  place: string;
}

// Every identifier below is fictional. Aadhaar numbers are generated with a valid Verhoeff check digit
// so the masker can be exercised, but they belong to nobody.
export const SAMPLES: SampleSpec[] = [
  {
    slug: 'personal-loan-fixed',
    title: 'Personal Loan Agreement',
    lender: 'Meridian Finance Limited',
    lenderShort: 'Meridian',
    loanType: 'personal loan',
    style: 'numbered',
    borrower: {
      name: 'Rohan Mehra',
      pan: 'AKLPM4821R',
      aadhaar: '',
      phone: '98201 44710',
      email: 'rohan.mehra.demo@example.com',
      account: '30412298765',
      ifsc: 'MRDN0004521',
      address: '14 Lotus Court, Andheri West, Mumbai 400053',
    },
    principal: 500_000,
    principalWords: 'Rupees Five Lakh only',
    annualRate: 14,
    rateType: 'fixed',
    method: 'reducing',
    benchmark: null,
    tenureMonths: 36,
    processingFee: { amount: null, percent: 2, description: 'Processing fee of 2% of the loan amount plus applicable GST' },
    insurancePremium: { amount: 6500, percent: null, description: 'Credit life insurance premium' },
    otherUpfrontCharges: [{ amount: 1800, percent: null, description: 'GST on processing fee' }],
    prepaymentCharges: { amount: null, percent: 4, description: '4% of the principal outstanding; no prepayment permitted during the first 12 EMIs' },
    latePaymentCharges: { amount: null, percent: 2, description: 'Penal interest of 2% per month on the overdue amount' },
    bounceCharges: { amount: 500, percent: null, description: 'Rs. 500 per dishonoured instrument or failed mandate' },
    risks: ['auto_debit_mandate', 'penal_interest', 'arbitration', 'broad_data_sharing'],
    agreementDate: '12 March 2026',
    place: 'Mumbai',
  },
  {
    slug: 'home-loan-floating',
    title: 'Housing Loan Agreement',
    lender: 'Sunrise Housing Finance Corporation Limited',
    lenderShort: 'Sunrise',
    loanType: 'housing loan',
    style: 'article',
    borrower: {
      name: 'Ananya Iyer',
      pan: 'BQRPI7734K',
      aadhaar: '',
      phone: '+91 76540 09182',
      email: 'ananya.iyer.demo@example.com',
      account: '110022334455',
      ifsc: 'SNRS0000731',
      address: '7B Jacaranda Enclave, Whitefield, Bengaluru 560066',
    },
    principal: 4_000_000,
    principalWords: 'Rupees Forty Lakh only',
    annualRate: 8.75,
    rateType: 'floating',
    method: 'reducing',
    benchmark: 'Sunrise Prime Lending Rate (SPLR) minus 2.25%',
    tenureMonths: 240,
    processingFee: { amount: 10000, percent: null, description: 'Flat processing fee of Rs. 10,000 inclusive of taxes' },
    insurancePremium: { amount: 45000, percent: null, description: 'Property insurance and credit-linked life cover premium, financed upfront' },
    otherUpfrontCharges: [
      { amount: 3500, percent: null, description: 'Legal and technical valuation charges' },
      { amount: 1200, percent: null, description: 'CERSAI registration and stamping charges' },
    ],
    prepaymentCharges: { amount: 0, percent: 0, description: 'Nil for floating rate loans to individual borrowers' },
    latePaymentCharges: { amount: null, percent: 24, description: 'Additional interest of 24% per annum on amounts overdue' },
    bounceCharges: { amount: 750, percent: null, description: 'Rs. 750 for every cheque or mandate return' },
    risks: ['unilateral_rate_change', 'security_interest', 'auto_debit_mandate', 'cross_default'],
    agreementDate: '4 January 2026',
    place: 'Bengaluru',
  },
  {
    slug: 'vehicle-loan-flat',
    title: 'Vehicle Loan Cum Hypothecation Agreement',
    lender: 'Trident Auto Credit Private Limited',
    lenderShort: 'Trident',
    loanType: 'vehicle loan',
    style: 'clause',
    borrower: {
      name: 'Farhan Qureshi',
      pan: 'CWEPQ1190L',
      aadhaar: '',
      phone: '9013377645',
      email: 'farhan.q.demo@example.com',
      account: '0987654321098',
      ifsc: 'TRDT0002210',
      address: '221 Sector 15, Dwarka, New Delhi 110078',
    },
    principal: 800_000,
    principalWords: 'Rupees Eight Lakh only',
    annualRate: 9.5,
    rateType: 'fixed',
    method: 'flat',
    benchmark: null,
    tenureMonths: 60,
    processingFee: { amount: null, percent: 1, description: 'Processing charge of 1% of the loan amount' },
    insurancePremium: { amount: null, percent: null, description: 'Not financed; the Borrower must maintain comprehensive motor insurance separately' },
    otherUpfrontCharges: [
      { amount: 1500, percent: null, description: 'Documentation charges' },
      { amount: 600, percent: null, description: 'Stamp duty' },
      { amount: 400, percent: null, description: 'Hypothecation endorsement charges' },
    ],
    prepaymentCharges: { amount: null, percent: 5, description: '5% of the principal outstanding on the date of foreclosure' },
    latePaymentCharges: { amount: null, percent: 3, description: 'Overdue interest at 3% per month on the amount in default' },
    bounceCharges: { amount: 450, percent: null, description: 'Rs. 450 per instance of dishonour' },
    risks: ['one_sided_termination', 'penal_interest', 'arbitration', 'security_interest'],
    agreementDate: '21 June 2026',
    place: 'New Delhi',
  },
  {
    slug: 'business-loan-kfs',
    title: 'Business Loan Sanction Letter and Key Facts Statement',
    lender: 'Cobalt Capital NBFC Limited',
    lenderShort: 'Cobalt',
    loanType: 'unsecured business loan',
    style: 'kfs',
    borrower: {
      name: 'Priya Venkatesan (Proprietor, Venkatesan Textiles)',
      pan: 'DXMPV5567C',
      aadhaar: '',
      phone: '0 88770 21456',
      email: 'priya.textiles.demo@example.com',
      account: '5020011122233',
      ifsc: 'CBLT0001108',
      address: '3 Mill Road, Tirupur 641604',
    },
    principal: 2_500_000,
    principalWords: 'Rupees Twenty-Five Lakh only',
    annualRate: 16,
    rateType: 'fixed',
    method: 'reducing',
    benchmark: null,
    tenureMonths: 48,
    processingFee: { amount: null, percent: 2.5, description: 'Processing fee of 2.5% of the sanctioned amount, deducted from disbursement' },
    insurancePremium: { amount: 18000, percent: null, description: 'Credit shield premium deducted from disbursement' },
    otherUpfrontCharges: [{ amount: 5000, percent: null, description: 'Legal and documentation charges' }],
    prepaymentCharges: { amount: null, percent: 2, description: '2% of the amount prepaid, permitted only after 6 months' },
    latePaymentCharges: { amount: null, percent: 3, description: 'Penal charge of 3% per annum over the contracted rate on the overdue amount' },
    bounceCharges: { amount: 1000, percent: null, description: 'Rs. 1,000 per bounced EMI' },
    risks: ['broad_data_sharing', 'auto_debit_mandate', 'unilateral_rate_change', 'penal_interest'],
    agreementDate: '9 August 2026',
    place: 'Coimbatore',
  },
  {
    slug: 'education-loan-floating',
    title: 'Education Loan Agreement',
    lender: 'Lumen Bank Limited',
    lenderShort: 'Lumen',
    loanType: 'education loan',
    style: 'schedule',
    borrower: {
      name: 'Devika Nair',
      pan: 'EFGPN2208H',
      aadhaar: '',
      phone: '+91-81234-56780',
      email: 'devika.nair.demo@example.com',
      account: '61234567890',
      ifsc: 'LUMN0100234',
      address: '18 Marine Lines, Kochi 682031',
    },
    principal: 1_200_000,
    principalWords: 'Rupees Twelve Lakh only',
    annualRate: 11.25,
    rateType: 'floating',
    method: 'reducing',
    benchmark: 'Lumen 1-year MCLR plus 2.40%',
    tenureMonths: 84,
    processingFee: { amount: 0, percent: 0, description: 'Nil' },
    insurancePremium: { amount: 4200, percent: null, description: 'Group credit life insurance premium' },
    otherUpfrontCharges: [],
    prepaymentCharges: { amount: 0, percent: 0, description: 'Nil; the loan may be prepaid in full or part at any time without charge' },
    latePaymentCharges: { amount: null, percent: 2, description: 'Penal interest of 2% per annum on the overdue instalment for the period of default' },
    bounceCharges: { amount: 250, percent: null, description: 'Rs. 250 per dishonoured instruction' },
    risks: ['cross_default', 'auto_debit_mandate', 'unilateral_rate_change', 'arbitration'],
    agreementDate: '2 July 2026',
    place: 'Kochi',
  },
];
