import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLlmClient } from '@docsense/server/app';
import { loadConfig } from '@docsense/server/config';
import { DocumentRepository, type DocumentRow } from '@docsense/server/db/documents';
import { createPool } from '@docsense/server/db/pool';
import { ContractFactsService } from '@docsense/server/extraction/contractFacts';
import { ExtractionService } from '@docsense/server/extraction/service';
import { ingest } from '@docsense/server/ingest/pipeline';
import { createLogger } from '@docsense/server/logger';
import { QaService } from '@docsense/server/qa/service';
import { EmbeddingService } from '@docsense/server/retrieval/embeddings';
import { HybridSearch } from '@docsense/server/retrieval/search';
import { RiskService } from '@docsense/server/risks/service';
import { exportFixture, importFixture } from './fixture.js';
import { GOLDEN, resolveExpected, type GoldenQuestion } from './golden.js';
import { checkExpect, citationsHit, mean, pagesOverlap, pct, scoreExtraction, type FieldResult } from './metrics.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const samplesDir = path.resolve(root, '../samples');

interface Args {
  subset: 'ci' | 'all';
  check: boolean;
  ablations: boolean;
  retrievalOnly: boolean;
  exportFixture: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { subset: 'all', check: false, ablations: false, retrievalOnly: false, exportFixture: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]!;
    if (v === '--subset') a.subset = argv[++i] === 'ci' ? 'ci' : 'all';
    else if (v === '--check') a.check = true;
    else if (v === '--ablations') a.ablations = true;
    else if (v === '--retrieval-only') a.retrievalOnly = true;
    else if (v === '--export-fixture') a.exportFixture = true;
  }
  return a;
}

interface Truth {
  slug: string;
  kind: string;
  [key: string]: unknown;
}

const TOP_K = 8;

interface RetrievalScore {
  at1: number;
  at4: number;
  at8: number;
  mrr: number;
}
const RETRIEVERS = [
  { name: 'hybrid (RRF)', vectorWeight: 1, textWeight: 1 },
  { name: 'vector only', vectorWeight: 1, textWeight: 0 },
  { name: 'full-text only', vectorWeight: 0, textWeight: 1 },
];
const CHUNK_SIZES = [200, 400, 800];

function expectedPages(q: GoldenQuestion, truth: Truth): number[] | null {
  if (q.pages) return q.pages;
  if (!q.pagesFrom) return null;
  const node = q.pagesFrom.split('.').reduce<unknown>((acc, key) => (acc as Record<string, unknown> | undefined)?.[key], truth);
  return ((node as { pages?: number[] } | undefined)?.pages ?? null) as number[] | null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig({ ...process.env, DATABASE_URL: process.env['DATABASE_URL'] ?? 'postgres://docsense:docsense@localhost:5432/docsense', LOG_LEVEL: 'warn' });
  if (!args.retrievalOnly && !config.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required (or pass --retrieval-only)');
  const logger = createLogger('warn');
  const db = createPool(config.DATABASE_URL);
  const llm = createLlmClient(config, logger);
  const documents = new DocumentRepository(db);
  const embeddings = new EmbeddingService(db, llm, logger);
  const search = new HybridSearch(db, embeddings);
  const qa = new QaService({ db, config, llm, documents, embeddings, search, logger });
  const extraction = new ExtractionService({ db, llm, documents, search, logger, extractionModel: config.GEMINI_EXTRACTION_MODEL });
  const contractFacts = new ContractFactsService({ db, llm, search, logger, model: config.GEMINI_EXTRACTION_MODEL });
  const risks = new RiskService({ db, llm, documents, logger });

  const cached = await importFixture(db);
  console.log(`embedding fixture: ${cached} vectors loaded`);

  const index = JSON.parse(await readFile(path.join(samplesDir, 'index.json'), 'utf8')) as { slug: string; file: string; kind: string }[];
  const kindOf = new Map(index.map((e) => [e.slug, e.kind]));
  const truths = new Map<string, Truth>();
  const docs = new Map<string, DocumentRow>();
  const created: string[] = [];
  const started = Date.now();

  try {
    for (const entry of index) {
      truths.set(entry.slug, JSON.parse(await readFile(path.join(samplesDir, 'ground-truth', `${entry.slug}.json`), 'utf8')) as Truth);
      const doc = await ingestSample(entry, {});
      docs.set(entry.slug, doc);
      created.push(doc.id);
    }
    console.log(`ingested ${docs.size} documents (${Date.now() - started} ms)`);

    const questions = GOLDEN.filter((q) => args.subset === 'all' || q.tags.includes('ci'));
    const lines: string[] = [];
    const summary: { metric: string; value: number; threshold?: number }[] = [];

    // --- retrieval ---
    const withPages = questions.filter((q) => expectedPages(q, truths.get(q.slug)!));
    const retrieval: Record<string, RetrievalScore> = {};
    for (const r of RETRIEVERS) {
      retrieval[r.name] = await scoreRetrieval(withPages, docs, (id, q) => search.search(id, q, { topK: TOP_K, vectorWeight: r.vectorWeight, textWeight: r.textWeight }));
    }
    summary.push({ metric: 'Retrieval recall@8 (hybrid)', value: retrieval['hybrid (RRF)']!.at8, threshold: 0.9 });
    summary.push({ metric: 'Retrieval recall@1 (hybrid)', value: retrieval['hybrid (RRF)']!.at1 });
    summary.push({ metric: 'Retrieval MRR (hybrid)', value: retrieval['hybrid (RRF)']!.mrr });
    lines.push('## Retrieval', '', `${withPages.length} questions with expected pages. A hit means a retrieved chunk overlaps an expected page; MRR uses the rank of the first hit.`, '', '| Retriever | recall@1 | recall@4 | recall@8 | MRR |', '|---|---|---|---|---|');
    for (const [name, r] of Object.entries(retrieval)) lines.push(`| ${name} | ${pct(r.at1)} | ${pct(r.at4)} | ${pct(r.at8)} | ${r.mrr.toFixed(3)} |`);
    lines.push('');

    // --- chunk-size ablation (hybrid) ---
    if (args.ablations) {
      lines.push('## Chunk size ablation (hybrid)', '', '| max tokens | recall@1 | recall@8 | MRR | avg chunks/doc |', '|---|---|---|---|---|');
      for (const size of CHUNK_SIZES) {
        const altDocs = new Map<string, DocumentRow>();
        for (const entry of index) {
          const doc = await ingestSample(entry, { maxTokens: size, overlapTokens: Math.round(size * 0.15) });
          altDocs.set(entry.slug, doc);
          created.push(doc.id);
        }
        const score = await scoreRetrieval(withPages, altDocs, (id, q) => search.search(id, q, { topK: TOP_K, vectorWeight: 1, textWeight: 1 }));
        const avgChunks = mean([...altDocs.values()].map((d) => d.chunk_count));
        lines.push(`| ${size} | ${pct(score.at1)} | ${pct(score.at8)} | ${score.mrr.toFixed(3)} | ${avgChunks.toFixed(1)} |`);
      }
      lines.push('');
    }

    if (!args.retrievalOnly) {
      // --- question answering ---
      const rows: string[] = [];
      const correct: number[] = [];
      const numericCorrect: number[] = [];
      const cited: number[] = [];
      const nid: number[] = [];
      const toolUse: number[] = [];
      for (const q of questions) {
        const truth = truths.get(q.slug)!;
        const expect = resolveExpected(q, truth);
        const pages = expectedPages(q, truth);
        const res = await qa.ask({ documentId: docs.get(q.slug)!.id, question: q.question, history: [] });
        const ok = checkExpect(expect, res.answer, res.citations);
        const hit = pages ? citationsHit(res.citations, pages) : null;
        correct.push(ok ? 1 : 0);
        if (expect.type === 'numeric') numericCorrect.push(ok ? 1 : 0);
        if (expect.type === 'not_in_document') nid.push(ok ? 1 : 0);
        if (hit !== null && expect.type !== 'not_in_document') cited.push(hit ? 1 : 0);
        if (q.needsTool) toolUse.push(res.toolCalls.length > 0 ? 1 : 0);
        rows.push(`| ${q.id} | ${expect.type} | ${ok ? 'yes' : 'NO'} | ${hit === null ? '–' : hit ? 'yes' : 'NO'} | ${res.toolCalls.length} | ${res.answer.replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 110)} |`);
        process.stdout.write(`${ok ? '.' : 'x'}`);
      }
      console.log('');
      summary.push({ metric: 'Answer accuracy (all)', value: mean(correct) });
      summary.push({ metric: 'Numeric answer accuracy', value: mean(numericCorrect), threshold: 0.8 });
      summary.push({ metric: 'Citation accuracy', value: mean(cited), threshold: 0.8 });
      summary.push({ metric: 'Not-in-document accuracy', value: mean(nid), threshold: 0.75 });
      summary.push({ metric: 'Tool used when arithmetic needed', value: mean(toolUse) });
      lines.push('## Question answering', '', `${questions.length} questions.`, '', '| id | type | correct | cited page | tools | answer |', '|---|---|---|---|---|---|', ...rows, '');

      // --- extraction ---
      const loanSlugs = [...docs.keys()].filter((s) => kindOf.get(s) === 'loan' && (args.subset === 'all' || s === 'personal-loan-fixed'));
      const perField = new Map<string, number[]>();
      const misses: string[] = [];
      for (const slug of loanSlugs) {
        const terms = await extraction.extract(docs.get(slug)!, { force: true });
        for (const f of scoreExtraction(terms, truths.get(slug)!) as FieldResult[]) {
          perField.set(f.field, [...(perField.get(f.field) ?? []), f.correct ? 1 : 0]);
          if (!f.correct) misses.push(`| ${slug} | ${f.field} | ${f.expected} | ${f.got} |`);
        }
      }
      const fieldAcc = [...perField.values()].flat();
      summary.push({ metric: `Extraction field accuracy (${loanSlugs.length} loan docs)`, value: mean(fieldAcc), threshold: 0.85 });
      lines.push('## Extraction', '', '| field | accuracy |', '|---|---|');
      for (const [field, v] of perField) lines.push(`| ${field} | ${pct(mean(v))} |`);
      lines.push('');
      if (misses.length) lines.push('Misses:', '', '| document | field | expected | got |', '|---|---|---|---|', ...misses, '');

      // --- contract facts (lease) ---
      if (args.subset === 'all') {
        const lease = docs.get('residential-lease')!;
        const facts = await contractFacts.extract(lease, { force: true });
        const checks: [string, string | null, string][] = [
          ['term', facts.term.value, '24'],
          ['paymentObligations', facts.paymentObligations.value, '38,000'],
          ['securityDeposit', facts.securityDeposit.value, '2,28,000'],
          ['noticePeriod', facts.noticePeriod.value, '60'],
          ['renewal', facts.renewal.value, '10%'],
          ['governingLaw', facts.governingLaw.value, 'arbitrat'],
          ['effectiveDate', facts.effectiveDate.value, 'August 2026'],
          ['parties', facts.parties.value.join(' '), 'Deshpande'],
        ];
        const ok = checks.map(([, v, needle]) => ((v ?? '').toLowerCase().includes(needle.toLowerCase()) ? 1 : 0));
        summary.push({ metric: 'Contract facts accuracy (lease)', value: mean(ok) });
        lines.push('## Contract facts (residential lease)', '', '| fact | contains | got |', '|---|---|---|', ...checks.map(([f, v, n], i) => `| ${f} | ${n} | ${ok[i] ? 'yes' : 'NO'}: ${(v ?? 'null').slice(0, 80)} |`), '');
      }

      // --- risk flags ---
      const riskSlugs = [...docs.keys()].filter((s) => kindOf.get(s) !== 'general' && (args.subset === 'all' || s === 'personal-loan-fixed'));
      const precision: number[] = [];
      const recall: number[] = [];
      lines.push('## Risk flags', '', '| document | expected | found | missed | extra |', '|---|---|---|---|---|');
      for (const slug of riskSlugs) {
        const truth = truths.get(slug)!;
        const expected = new Set(((truth['risks'] as { category?: string }[] | string[]) ?? []).map((r) => (typeof r === 'string' ? r : r.category!)));
        const flags = await risks.detect(docs.get(slug)!, { force: true });
        const found = new Set<string>(flags.map((f) => f.category));
        const tp = [...found].filter((c) => expected.has(c)).length;
        precision.push(found.size ? tp / found.size : 1);
        recall.push(expected.size ? tp / expected.size : 1);
        lines.push(`| ${slug} | ${expected.size} | ${found.size} | ${[...expected].filter((c) => !found.has(c)).join(', ') || '–'} | ${[...found].filter((c) => !expected.has(c)).join(', ') || '–'} |`);
      }
      lines.push('');
      summary.push({ metric: 'Risk flag precision', value: mean(precision) });
      summary.push({ metric: 'Risk flag recall', value: mean(recall) });
    }

    // --- report ---
    const header = [
      `# Evaluation report (${args.subset === 'ci' ? 'CI subset' : 'full'})`,
      '',
      `Run: ${new Date().toISOString()} · chat model \`${config.GEMINI_CHAT_MODEL}\` · embeddings \`${config.GEMINI_EMBEDDING_MODEL}\` (${config.EMBEDDING_DIMENSIONS}d) · top-k ${TOP_K} · ${((Date.now() - started) / 1000).toFixed(0)} s`,
      '',
      '| metric | value | threshold |',
      '|---|---|---|',
      ...summary.map((s) => `| ${s.metric} | ${pct(s.value)} | ${s.threshold !== undefined ? pct(s.threshold) : '–'} |`),
      '',
    ];
    const report = [...header, ...lines].join('\n');
    await mkdir(path.join(root, 'reports'), { recursive: true });
    const file = path.join(root, 'reports', args.subset === 'ci' ? 'ci.md' : 'latest.md');
    await writeFile(file, report + '\n');
    await writeFile(file.replace(/\.md$/, '.json'), JSON.stringify({ run: new Date().toISOString(), summary, retrieval }, null, 2) + '\n');
    console.log(report.split('\n').slice(0, 6 + summary.length).join('\n'));
    console.log(`\nreport: ${path.relative(process.cwd(), file)}`);

    if (args.exportFixture) console.log(`fixture: ${await exportFixture(db)} vectors exported`);

    if (args.check) {
      const failed = summary.filter((s) => s.threshold !== undefined && s.value < s.threshold);
      if (failed.length) {
        console.error(`\nTHRESHOLDS NOT MET:\n${failed.map((f) => `  ${f.metric}: ${pct(f.value)} < ${pct(f.threshold!)}`).join('\n')}`);
        process.exitCode = 1;
      } else {
        console.log('\nall thresholds met');
      }
    }
  } finally {
    for (const id of created) await documents.delete(id);
    await db.end();
  }

  async function scoreRetrieval(
    qs: GoldenQuestion[],
    docMap: Map<string, DocumentRow>,
    run: (documentId: string, question: string) => Promise<{ page_start: number; page_end: number }[]>,
  ): Promise<RetrievalScore> {
    const at1: number[] = [];
    const at4: number[] = [];
    const at8: number[] = [];
    const rr: number[] = [];
    for (const q of qs) {
      const pages = expectedPages(q, truths.get(q.slug)!)!;
      const results = await run(docMap.get(q.slug)!.id, q.question);
      const first = results.findIndex((c) => pagesOverlap(c.page_start, c.page_end, pages));
      at1.push(first === 0 ? 1 : 0);
      at4.push(first >= 0 && first < 4 ? 1 : 0);
      at8.push(first >= 0 && first < 8 ? 1 : 0);
      rr.push(first >= 0 ? 1 / (first + 1) : 0);
    }
    return { at1: mean(at1), at4: mean(at4), at8: mean(at8), mrr: mean(rr) };
  }

  async function ingestSample(entry: { slug: string; file: string }, chunk: { maxTokens?: number; overlapTokens?: number }) {
    const buffer = await readFile(path.join(samplesDir, entry.file));
    const result = await ingest({ buffer, mimeType: 'application/pdf', fileName: `${entry.slug}.pdf` }, { maxPages: 60, chunk });
    const row = await documents.createWithChunks(
      { title: `eval ${entry.slug}`, sourceType: 'pdf', kind: result.kind, contentHash: result.contentHash, pageCount: result.pageCount, ttlHours: 1 },
      result.chunks,
    );
    await embeddings.embedDocument(row.id);
    return (await documents.findById(row.id))!;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
