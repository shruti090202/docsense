import { z } from 'zod';
import { costFromTerms, type CompareResponse, type LoanTerms, type RiskFlag } from '@docsense/shared';
import type { DocumentRepository } from '../db/documents.js';
import type { ExtractionService } from '../extraction/service.js';
import { HttpError, badRequest, notFound } from '../http/errors.js';
import type { LlmClient } from '../llm/types.js';
import type { Logger } from '../logger.js';

const NarrativeSchema = z.object({
  summary: z.string().describe('3-4 plain-English sentences on which offer is cheaper overall and the main trade-offs'),
  differences: z.array(
    z.object({
      aspect: z.string().describe('e.g. Interest rate, Processing fee, Prepayment charges'),
      left: z.string().describe('value for offer A, as stated'),
      right: z.string().describe('value for offer B, as stated'),
      favours: z.enum(['left', 'right', 'neither']),
      note: z.string().describe('one sentence on why it matters'),
    }),
  ),
});

function narrativeJsonSchema(): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(NarrativeSchema, { target: 'draft-7' }) as Record<string, unknown>;
  return rest;
}

const COMPARE_SYSTEM_PROMPT = `You compare two loan offers for a borrower using ONLY the structured terms and pre-computed cost figures provided. All numbers were computed by code; quote them, never recalculate or invent figures. Write plainly for a non-lawyer. Cover interest rate and method, tenure, EMI, upfront fees, effective annual rate, prepayment terms, penal and bounce charges, and any risk flags. This is educational information, not advice.`;

function describe(terms: LoanTerms): Record<string, unknown> {
  const fee = (f: LoanTerms['processingFee']) => (f.notFound ? 'not stated' : { amount: f.amount, percent: f.percent, description: f.description });
  return {
    lender: terms.lenderName.value ?? 'not stated',
    principal: terms.principal.amount ?? 'not stated',
    interestRate: terms.interestRate.notFound
      ? 'not stated'
      : { annualPercent: terms.interestRate.annualPercent, type: terms.interestRate.rateType, method: terms.interestRate.method, benchmark: terms.interestRate.benchmark },
    tenureMonths: terms.tenureMonths.value ?? 'not stated',
    statedEmi: terms.statedEmi.amount ?? 'not stated',
    processingFee: fee(terms.processingFee),
    insurancePremium: fee(terms.insurancePremium),
    otherUpfrontCharges: terms.otherUpfrontCharges.map(fee),
    prepaymentCharges: fee(terms.prepaymentCharges),
    latePaymentCharges: fee(terms.latePaymentCharges),
    bounceCharges: fee(terms.bounceCharges),
  };
}

// A document whose risk review has not run yet must not read as "no risks".
function describeRisks(flags: RiskFlag[] | null): string[] | string {
  if (flags === null) return 'not assessed';
  return flags.length ? flags.map((r) => `${r.severity}: ${r.title}`) : ['none found'];
}

export class CompareService {
  constructor(
    private readonly deps: { llm: LlmClient; documents: DocumentRepository; extraction: ExtractionService; logger: Logger },
  ) {}

  async compare(leftId: string, rightId: string): Promise<CompareResponse> {
    if (leftId === rightId) throw badRequest('SAME_DOCUMENT', 'Choose two different documents to compare');
    const [left, right] = await Promise.all([this.deps.documents.findById(leftId), this.deps.documents.findById(rightId)]);
    if (!left || !right) throw notFound('One of the documents was not found or has expired');
    const leftTerms = await this.deps.extraction.extract(left);
    const rightTerms = await this.deps.extraction.extract(right);
    const leftCost = costFromTerms(leftTerms);
    const rightCost = costFromTerms(rightTerms);
    let cheaper: CompareResponse['cheaper'] = 'unknown';
    if (leftCost.cost && rightCost.cost && leftCost.cost.effectiveAnnualRatePercent !== rightCost.cost.effectiveAnnualRatePercent) {
      cheaper = leftCost.cost.effectiveAnnualRatePercent < rightCost.cost.effectiveAnnualRatePercent ? 'left' : 'right';
    }

    const payload = {
      offerA: { title: left.title, terms: describe(leftTerms), cost: leftCost.cost, riskFlags: describeRisks(left.risk_flags) },
      offerB: { title: right.title, terms: describe(rightTerms), cost: rightCost.cost, riskFlags: describeRisks(right.risk_flags) },
      cheaperByEffectiveAnnualRate: cheaper === 'left' ? 'offerA' : cheaper === 'right' ? 'offerB' : 'unknown',
    };
    const res = await this.deps.llm.generate({
      system: COMPARE_SYSTEM_PROMPT,
      messages: [{ role: 'user', parts: [{ text: `Offer A is "left", offer B is "right".\n\n${JSON.stringify(payload, null, 2)}` }] }],
      responseSchema: narrativeJsonSchema(),
      temperature: 0.2,
      maxOutputTokens: 2048,
    });
    let narrative: z.infer<typeof NarrativeSchema>;
    try {
      narrative = NarrativeSchema.parse(JSON.parse(res.text ?? ''));
    } catch {
      throw new HttpError(502, 'LLM_BAD_RESPONSE', 'Comparison narrative was not in the expected shape');
    }
    this.deps.logger.info({ leftId, rightId, cheaper, differences: narrative.differences.length }, 'offers compared');
    return {
      left: { documentId: left.id, title: left.title, terms: leftTerms, cost: leftCost, riskFlags: left.risk_flags },
      right: { documentId: right.id, title: right.title, terms: rightTerms, cost: rightCost, riskFlags: right.risk_flags },
      summary: narrative.summary,
      differences: narrative.differences,
      cheaper,
    };
  }
}
