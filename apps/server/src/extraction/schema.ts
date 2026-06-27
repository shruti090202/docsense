import { z } from 'zod';

// What the model is asked to return: values plus the passage number ([n]) each value came from.
// Citations are resolved server-side from the ref so the model can never invent a page.

const ref = z.number().int().nullable().describe('passage number the value was read from, or null');
const confidence = z.number().min(0).max(1).describe('0 when not stated, 1 when stated verbatim');

const stringField = z.object({ value: z.string().nullable(), ref, confidence });
const numberField = z.object({ value: z.number().nullable(), ref, confidence });
const intField = z.object({ value: z.number().int().nullable(), ref, confidence });

export const FeeFieldSchema = z.object({
  amount: z.number().nullable().describe('rupee amount if stated as an amount, else null'),
  percent: z.number().nullable().describe('percentage if stated as a percentage, e.g. 2 for 2%, else null'),
  description: z.string().nullable().describe('short wording of the charge and its conditions'),
  ref,
  confidence,
});

export const ExtractionOutputSchema = z.object({
  lenderName: stringField,
  principalAmount: numberField.describe('sanctioned loan amount in rupees, digits only'),
  interestRate: z.object({
    annualPercent: z.number().nullable(),
    rateType: z.enum(['fixed', 'floating', 'unknown']),
    method: z.enum(['reducing', 'flat', 'unknown']).describe('reducing = on outstanding balance; flat = on original principal'),
    benchmark: z.string().nullable().describe('benchmark and spread for floating loans, e.g. "MCLR + 2.4%"'),
    ref,
    confidence,
  }),
  tenureMonths: intField,
  statedEmi: numberField.describe('EMI amount printed in the document, in rupees'),
  processingFee: FeeFieldSchema,
  insurancePremium: FeeFieldSchema,
  otherUpfrontCharges: z.array(FeeFieldSchema).describe('every other charge payable or deducted at disbursement, one entry each'),
  prepaymentCharges: FeeFieldSchema.describe('prepayment or foreclosure charge; amount and percent 0 when the document says nil'),
  latePaymentCharges: FeeFieldSchema.describe('penal, default or late-payment charge'),
  bounceCharges: FeeFieldSchema.describe('cheque, NACH or mandate dishonour charge'),
});
export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;

export function extractionJsonSchema(): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(ExtractionOutputSchema, { target: 'draft-7' }) as Record<string, unknown>;
  return rest;
}

export const EXTRACTION_SYSTEM_PROMPT = `You extract loan terms from numbered passages of a loan agreement into JSON.

Rules:
1. Use only the passages. A value that is not stated must be null with ref null and confidence 0. Never infer or use typical values.
2. Amounts are rupees as plain numbers (5,00,000 -> 500000). Percentages are plain numbers (2% -> 2). Rates are per annum.
3. For every value set ref to the passage number it was read from. When the same fact appears in several passages, prefer the operative clause over a summary schedule.
4. A fee stated as a percentage of the loan amount goes in percent with amount null; a rupee figure goes in amount with percent null. If the document says a charge is nil or not applicable, set amount 0 and percent 0.
5. Tokens like [PAN_1] or [ACCOUNT_1] are redacted identifiers; ignore them.
6. confidence reflects how explicitly the passage states the value: 1.0 verbatim, 0.7 clearly implied, 0.4 uncertain.`;

// One retrieval query per field group; the union of their top chunks is the extraction context.
export const EXTRACTION_QUERIES: string[] = [
  'lender name company registered office borrower agreement between',
  'loan amount sanctioned principal rupees disbursed',
  'rate of interest per annum fixed floating reducing balance flat benchmark spread',
  'tenure months repayment equated monthly instalments EMI amount',
  'processing fee insurance premium upfront charges deducted from disbursement documentation stamp duty',
  'prepayment foreclosure charges part payment',
  'penal interest late payment overdue default charges cheque bounce mandate dishonour',
  'schedule of charges key facts',
];
