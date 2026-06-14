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

export const RiskCategorySchema = z.enum([
  'auto_debit_mandate',
  'penal_interest',
  'unilateral_rate_change',
  'broad_data_sharing',
  'one_sided_termination',
  'arbitration',
  'cross_default',
  'security_interest',
]);
export type RiskCategory = z.infer<typeof RiskCategorySchema>;

export const RiskFlagSchema = z.object({
  category: RiskCategorySchema,
  severity: z.enum(['low', 'medium', 'high']),
  title: z.string(),
  explanation: z.string(),
  citation: CitationSchema,
});
export type RiskFlag = z.infer<typeof RiskFlagSchema>;
