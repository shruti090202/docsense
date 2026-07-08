import { z } from 'zod';
import { emiFlat, emiReducing, loanCost, round2 } from '@docsense/shared';
import type { ToolDefinition } from '../llm/types.js';

const method = z.enum(['reducing', 'flat']).describe('reducing = interest on the outstanding balance (standard EMI); flat = interest on the original principal for the whole tenure');

const EmiArgs = z.object({
  principal: z.number().positive().describe('loan amount in rupees'),
  annualRatePercent: z.number().min(0).describe('annual interest rate in percent, e.g. 14 for 14% p.a.'),
  tenureMonths: z.number().int().positive().describe('number of monthly instalments'),
  method: method.default('reducing'),
});

const TotalCostArgs = z.object({
  principal: z.number().positive().describe('loan amount in rupees'),
  emi: z.number().positive().describe('monthly instalment in rupees, as stated in the document or from calculate_emi'),
  tenureMonths: z.number().int().positive(),
  upfrontFees: z.number().min(0).default(0).describe('sum of all charges paid or deducted at disbursement, in rupees'),
});

const EffectiveRateArgs = z.object({
  principal: z.number().positive().describe('loan amount in rupees'),
  annualRatePercent: z.number().min(0).describe('contracted annual interest rate in percent'),
  tenureMonths: z.number().int().positive(),
  method: method.default('reducing'),
  upfrontFees: z.number().min(0).default(0).describe('sum of all charges paid or deducted at disbursement, in rupees'),
  statedEmi: z.number().positive().optional().describe('EMI as printed in the document, if any'),
});

const SumArgs = z.object({
  amounts: z.array(z.number()).min(1).describe('rupee amounts to add together'),
});

const PercentOfArgs = z.object({
  percent: z.number().min(0).describe('percentage, e.g. 2 for 2%'),
  amount: z.number().min(0).describe('base amount in rupees'),
});

// Gemini accepts JSON Schema directly; Zod's output just needs the $schema marker removed.
function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>;
  return rest;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'calculate_emi',
    description: 'Compute the equated monthly instalment for a loan from principal, annual rate, tenure and interest method.',
    parameters: jsonSchema(EmiArgs),
  },
  {
    name: 'calculate_total_cost',
    description: 'Compute total repayment, total interest and total cost of credit (interest plus upfront fees) for a loan.',
    parameters: jsonSchema(TotalCostArgs),
  },
  {
    name: 'calculate_effective_annual_rate',
    description:
      'Compute the true annualised cost of a loan (IRR of the real cash flows including upfront fees) as an effective annual rate and an APR. Use this whenever the user asks what a loan really costs, the true or effective rate, or wants to compare offers.',
    parameters: jsonSchema(EffectiveRateArgs),
  },
  {
    name: 'sum_amounts',
    description: 'Add several rupee amounts together, e.g. to total the upfront charges before calling calculate_effective_annual_rate.',
    parameters: jsonSchema(SumArgs),
  },
  {
    name: 'percent_of',
    description: 'Compute a percentage of an amount, e.g. a 2% processing fee on the loan amount.',
    parameters: jsonSchema(PercentOfArgs),
  },
];

export type ToolResult = Record<string, unknown>;

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Every rupee figure is returned twice: as a number and as an Indian-formatted string. The model is told
// to copy the string; re-typing 380000.2 as "3,800,000.20" is exactly the kind of slip this prevents.
function withDisplay(result: Record<string, unknown>): ToolResult {
  const display: Record<string, string> = {};
  for (const [k, v] of Object.entries(result)) {
    if (typeof v !== 'number') continue;
    display[k] = /percent|rate/i.test(k) ? `${v.toFixed(2)}%` : k === 'tenureMonths' ? `${v} months` : `Rs. ${inr.format(v)}`;
  }
  return { ...result, display };
}

export function executeTool(name: string, args: Record<string, unknown>): ToolResult {
  try {
    switch (name) {
      case 'calculate_emi': {
        const a = EmiArgs.parse(args);
        const emi = a.method === 'flat' ? emiFlat(a.principal, a.annualRatePercent, a.tenureMonths) : emiReducing(a.principal, a.annualRatePercent, a.tenureMonths);
        return withDisplay({ emi: round2(emi), method: a.method });
      }
      case 'calculate_total_cost': {
        const a = TotalCostArgs.parse(args);
        const totalRepayment = round2(a.emi * a.tenureMonths);
        const totalInterest = round2(totalRepayment - a.principal);
        return withDisplay({ totalRepayment, totalInterest, upfrontFees: round2(a.upfrontFees), totalCostOfCredit: round2(totalInterest + a.upfrontFees) });
      }
      case 'calculate_effective_annual_rate': {
        const a = EffectiveRateArgs.parse(args);
        const r = loanCost({ ...a, statedEmi: a.statedEmi });
        return withDisplay({ ...r });
      }
      case 'sum_amounts': {
        const a = SumArgs.parse(args);
        return withDisplay({ total: round2(a.amounts.reduce((s, x) => s + x, 0)) });
      }
      case 'percent_of': {
        const a = PercentOfArgs.parse(args);
        return withDisplay({ result: round2((a.percent / 100) * a.amount) });
      }
      default:
        return { error: `unknown tool ${name}` };
    }
  } catch (err) {
    // the model sees the validation message and can correct its arguments
    return { error: err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : (err as Error).message };
  }
}
