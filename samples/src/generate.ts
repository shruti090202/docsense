import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { round2, verhoeffGenerate } from '@docsense/shared';
import { buildBlocks, statedEmi } from './content.js';
import { renderPdf, type Block } from './render.js';
import { SAMPLES, type SampleSpec } from './spec.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Deterministic fictional Aadhaar numbers: 11 fixed digits + Verhoeff check digit.
const AADHAAR_BASES = ['53187204691', '62039471852', '74810293675', '85926301748', '91735028463'];

function withAadhaar(spec: SampleSpec, i: number): SampleSpec {
  const base = AADHAAR_BASES[i]!;
  const full = base + verhoeffGenerate(base);
  const grouped = `${full.slice(0, 4)} ${full.slice(4, 8)} ${full.slice(8)}`;
  return { ...spec, borrower: { ...spec.borrower, aadhaar: grouped } };
}

function pagesFor(tagPages: Record<string, number[]>, tag: string): number[] {
  return [...(tagPages[tag] ?? [])].sort((a, b) => a - b);
}

function groundTruth(spec: SampleSpec, pageCount: number, tagPages: Record<string, number[]>) {
  const emi = statedEmi(spec);
  const totalRepayment = round2(emi * spec.tenureMonths);
  const pct = (p: number | null) => (p !== null && p > 0 ? round2((spec.principal * p) / 100) : null);
  const feeAmount = (f: SampleSpec['processingFee']) => f.amount ?? pct(f.percent) ?? 0;
  const upfront = feeAmount(spec.processingFee) + (spec.insurancePremium.amount ?? 0) + spec.otherUpfrontCharges.reduce((s, f) => s + feeAmount(f), 0);
  return {
    slug: spec.slug,
    title: spec.title,
    file: `pdf/${spec.slug}.pdf`,
    pageCount,
    terms: {
      lenderName: { value: spec.lender, pages: pagesFor(tagPages, 'lenderName') },
      principal: { amount: spec.principal, pages: pagesFor(tagPages, 'principal') },
      interestRate: {
        annualPercent: spec.annualRate,
        rateType: spec.rateType,
        method: spec.method,
        benchmark: spec.benchmark,
        pages: pagesFor(tagPages, 'interestRate'),
      },
      tenureMonths: { value: spec.tenureMonths, pages: pagesFor(tagPages, 'tenureMonths') },
      statedEmi: { amount: emi, pages: pagesFor(tagPages, 'statedEmi') },
      processingFee: { amount: spec.processingFee.amount, percent: spec.processingFee.percent, resolvedAmount: feeAmount(spec.processingFee), pages: pagesFor(tagPages, 'processingFee') },
      insurancePremium: { amount: spec.insurancePremium.amount, percent: spec.insurancePremium.percent, pages: pagesFor(tagPages, 'insurancePremium') },
      otherUpfrontCharges: spec.otherUpfrontCharges.map((f, i) => ({ description: f.description, amount: f.amount, percent: f.percent, pages: pagesFor(tagPages, `otherUpfront:${i}`) })),
      prepaymentCharges: { amount: spec.prepaymentCharges.amount, percent: spec.prepaymentCharges.percent, pages: pagesFor(tagPages, 'prepaymentCharges') },
      latePaymentCharges: { amount: spec.latePaymentCharges.amount, percent: spec.latePaymentCharges.percent, pages: pagesFor(tagPages, 'latePaymentCharges') },
      bounceCharges: { amount: spec.bounceCharges.amount, percent: spec.bounceCharges.percent, pages: pagesFor(tagPages, 'bounceCharges') },
    },
    risks: spec.risks.map((category) => ({ category, pages: pagesFor(tagPages, `risk:${category}`) })),
    absentRisks: (['auto_debit_mandate', 'penal_interest', 'unilateral_rate_change', 'broad_data_sharing', 'one_sided_termination', 'arbitration', 'cross_default', 'security_interest'] as const).filter((r) => !spec.risks.includes(r)),
    computed: { emi, totalRepayment, totalInterest: round2(totalRepayment - spec.principal), upfrontCharges: round2(upfront), netDisbursal: round2(spec.principal - upfront) },
    pii: { ...spec.borrower },
  };
}

async function renderDocx(blocks: Block[], title: string): Promise<Buffer> {
  const children: Paragraph[] = [];
  for (const b of blocks) {
    if (b.kind === 'title') children.push(new Paragraph({ text: b.text, heading: HeadingLevel.TITLE }));
    else if (b.kind === 'heading') children.push(new Paragraph({ text: b.text, heading: HeadingLevel.HEADING_1 }));
    else if (b.kind === 'para') children.push(new Paragraph({ children: [new TextRun(b.text)] }));
    else if (b.kind === 'kv') children.push(new Paragraph({ children: [new TextRun({ text: `${b.key}: `, bold: true }), new TextRun(b.value)] }));
    else children.push(new Paragraph({ text: '' }));
  }
  const doc = new Document({ title, sections: [{ children }] });
  return Packer.toBuffer(doc);
}

async function main() {
  await Promise.all(['pdf', 'docx', 'ground-truth'].map((d) => mkdir(path.join(root, d), { recursive: true })));
  const index: { slug: string; title: string; file: string; pageCount: number }[] = [];
  for (const [i, raw] of SAMPLES.entries()) {
    const spec = withAadhaar(raw, i);
    const blocks = buildBlocks(spec);
    const pdf = await renderPdf(blocks, { title: `${spec.lender} - ${spec.title}`, author: spec.lender });
    await writeFile(path.join(root, 'pdf', `${spec.slug}.pdf`), pdf.bytes);
    const truth = groundTruth(spec, pdf.pageCount, pdf.tagPages);
    await writeFile(path.join(root, 'ground-truth', `${spec.slug}.json`), JSON.stringify(truth, null, 2) + '\n');
    if (i === 0) await writeFile(path.join(root, 'docx', `${spec.slug}.docx`), await renderDocx(blocks, spec.title));
    index.push({ slug: spec.slug, title: `${spec.lenderShort} ${spec.title}`, file: truth.file, pageCount: pdf.pageCount });
    console.log(`${spec.slug}: ${pdf.pageCount} pages`);
  }
  await writeFile(path.join(root, 'index.json'), JSON.stringify(index, null, 2) + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
