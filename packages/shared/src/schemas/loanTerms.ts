import { z } from 'zod';
import { CitationSchema } from './common.js';

const Evidence = z.object({
  citation: CitationSchema.nullable(),
  confidence: z.number().min(0).max(1),
  notFound: z.boolean().default(false),
});

const money = z.number().nonnegative();
const percent = z.number().min(0).max(100);

export const InterestRateSchema = Evidence.extend({
  annualPercent: percent.nullable(),
  rateType: z.enum(['fixed', 'floating', 'unknown']),
  method: z.enum(['reducing', 'flat', 'unknown']),
  benchmark: z.string().nullable(),
});
export type InterestRate = z.infer<typeof InterestRateSchema>;

export const FeeSchema = Evidence.extend({
  amount: money.nullable(),
  percent: percent.nullable(),
  description: z.string().nullable(),
});
export type Fee = z.infer<typeof FeeSchema>;

export const LoanTermsSchema = z.object({
  lenderName: Evidence.extend({ value: z.string().nullable() }),
  principal: Evidence.extend({ amount: money.nullable(), currency: z.string().default('INR') }),
  interestRate: InterestRateSchema,
  tenureMonths: Evidence.extend({ value: z.number().int().positive().nullable() }),
  statedEmi: Evidence.extend({ amount: money.nullable() }),
  processingFee: FeeSchema,
  insurancePremium: FeeSchema,
  otherUpfrontCharges: z.array(FeeSchema),
  prepaymentCharges: FeeSchema,
  latePaymentCharges: FeeSchema,
  bounceCharges: FeeSchema,
});
export type LoanTerms = z.infer<typeof LoanTermsSchema>;

export const DocumentKindSchema = z.enum(['loan', 'contract', 'general']);
export type DocumentKind = z.infer<typeof DocumentKindSchema>;

// Loan-specific categories first, then clauses that bite in any contract (rent, lease, employment, services).
export const RiskCategorySchema = z.enum([
  'auto_debit_mandate',
  'penal_interest',
  'unilateral_rate_change',
  'broad_data_sharing',
  'one_sided_termination',
  'arbitration',
  'cross_default',
  'security_interest',
  'auto_renewal',
  'lock_in',
  'deposit_forfeiture',
  'broad_indemnity',
  'non_compete',
  'liability_limitation',
  'unilateral_amendment',
]);
export type RiskCategory = z.infer<typeof RiskCategorySchema>;

export const LOAN_RISK_CATEGORIES: RiskCategory[] = [
  'auto_debit_mandate',
  'penal_interest',
  'unilateral_rate_change',
  'broad_data_sharing',
  'one_sided_termination',
  'arbitration',
  'cross_default',
  'security_interest',
];

export const CONTRACT_RISK_CATEGORIES: RiskCategory[] = [
  'auto_renewal',
  'lock_in',
  'deposit_forfeiture',
  'broad_indemnity',
  'non_compete',
  'liability_limitation',
  'unilateral_amendment',
  'one_sided_termination',
  'arbitration',
  'broad_data_sharing',
  'penal_interest',
];

export const RiskFlagSchema = z.object({
  category: RiskCategorySchema,
  severity: z.enum(['low', 'medium', 'high']),
  title: z.string(),
  explanation: z.string(),
  citation: CitationSchema,
});
export type RiskFlag = z.infer<typeof RiskFlagSchema>;

const Fact = Evidence.extend({ value: z.string().nullable() });

// Compact facts for any non-loan agreement: what a tenant, employee or customer actually needs to see first.
export const ContractFactsSchema = z.object({
  documentType: Fact,
  parties: Evidence.extend({ value: z.array(z.string()) }),
  effectiveDate: Fact,
  term: Fact,
  paymentObligations: Fact,
  securityDeposit: Fact,
  noticePeriod: Fact,
  terminationConditions: Fact,
  renewal: Fact,
  governingLaw: Fact,
});
export type ContractFacts = z.infer<typeof ContractFactsSchema>;

// For documents that are not agreements at all: a summary and a cited outline.
export const OutlineSchema = z.object({
  title: z.string(),
  summary: z.string(),
  sections: z.array(
    z.object({
      heading: z.string(),
      gist: z.string(),
      citation: CitationSchema.nullable(),
    }),
  ),
});
export type Outline = z.infer<typeof OutlineSchema>;
