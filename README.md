# DocSense

Understand what you are about to sign. Upload a loan agreement and DocSense extracts the key terms with page
citations, computes what the loan really costs, and flags one-sided clauses. Upload any other contract for its
key facts and risky clauses, or any document at all to ask questions and get answers that cite the exact lines.

**Live demo:** https://docsense-gamma.vercel.app · **API:** https://docsense-api-6k55.onrender.com (`/health`)

> Educational portfolio project. Not financial or legal advice. Sample documents are fictional. The demo runs
> on free tiers: the API sleeps after 15 idle minutes and takes about a minute to wake up.

## The problem

Indian retail loan agreements bury the cost of credit: a "9.5% flat" vehicle loan costs 18.5% a year once the
flat-rate method and upfront fees are accounted for; prepayment lock-ins, compounding penal interest and
lender-appointed arbitration sit in clauses nobody reads. Generic "chat with your PDF" tools paraphrase the
document but cannot be trusted with arithmetic, cite nothing verifiable, and send personal identifiers to a
third-party model. DocSense is built around those three failures.

## What it does

| Document kind | Analysis |
|---|---|
| Loan agreement | Typed extraction of 11 terms (principal, rate and method, tenure, EMI, every fee, prepayment, penal and bounce charges), each with a citation and confidence · EMI, total interest and the **effective annual rate** as the IRR of the real cash flows, computed by code · 8 lender-risk categories · side-by-side comparison of two offers |
| Any other contract (lease, employment, services) | 10 key facts with citations (parties, term, payments, deposit, notice, termination, renewal, governing law) · 7 contract-risk categories (auto-renewal, lock-in, deposit forfeiture, indemnity, non-compete, liability cap, unilateral amendment) plus the shared ones |
| Anything else (notes, reports) | A cited outline and Q&A |

Every document: cited Q&A that answers only from the text, refuses when the answer is not there, and calls
deterministic calculators for any arithmetic. Clicking a citation scrolls the viewer to the page and highlights
the exact lines. The document kind is detected from the text by a keyword-density classifier; no setup.

## Architecture

```
Browser (React, Vercel)                       API (Express, Render free)                   Neon Postgres
┌────────────────────────┐   multipart      ┌──────────────────────────────────────┐   ┌────────────────┐
│ file stays in memory   │ ───────────────► │ pdf.js / mammoth → pages             │   │ documents      │
│ react-pdf viewer       │                  │ PII mask (Aadhaar·PAN·IFSC·A/c·phone·│   │ chunks         │
│ placeholder map        │ ◄─── map ─────── │   e-mail) → placeholders             │──►│  + tsvector    │
│ chat history           │                  │ classify kind → clause-aware chunks  │   │  + vector(768) │
│ unmask at render       │                  │ embed (cache by hash) ─► Gemini      │   │ embedding_cache│
│                        │   question       │ hybrid search: pgvector ⊕ FTS → RRF  │   │ qa_cache       │
│ citation click →       │ ───────────────► │ Gemini + calculator tools (loop)     │   └────────────────┘
│   highlight lines      │ ◄── answer ───── │ [n] → page/clause/quote citations    │
└────────────────────────┘   + citations    │ extraction / facts / outline / risks │   GitHub Actions
                                            │ /internal/cleanup (24 h TTL)         │ ◄─ cron every 6 h
                                            └──────────────────────────────────────┘ ◄─ eval on PR + weekly
```

Monorepo (npm workspaces): `packages/shared` (Zod schemas, loan math), `apps/server`, `apps/web`, `samples`
(generated corpus + ground truth), `eval` (harness, golden dataset, fixture, reports).

## The RAG pipeline, step by step

1. **Parse with page numbers.** `pdfjs-dist` returns positioned text runs; lines are rebuilt by baseline and
   x-order so every line knows its page. Image-only PDFs are rejected with a clear 422. DOCX goes through
   mammoth (no pages; citations use clause titles).
2. **Mask PII before anything else.** Six detectors replace Aadhaar (12 digits *and* a valid Verhoeff
   checksum), PAN (holder-type letter validated), IFSC, account numbers (context-anchored), phones (currency-
   prefix guard) and e-mails with typed placeholders `[PAN_1]`. The map goes back to the browser once; the
   database and every model call only ever see placeholders.
3. **Classify the kind.** Credit-vocabulary and agreement-vocabulary densities per 1,000 words, with an
   agreement gate so notes *about* loans are not loan agreements.
4. **Chunk by clause.** Headings (`5.2 Prepayment`, `ARTICLE III`, ALL-CAPS titles) start sections; long
   sections are split into ~400-token sentence windows with 60 tokens of overlap, the clause title prefixed to
   each window; page ranges tracked per sentence. Abbreviations such as "Rs." do not end sentences.
5. **Embed with a cache.** `gemini-embedding-001` truncated to 768 dimensions, normalised, keyed by
   `sha256(model:dims:task:text)`. Embedding is a separate, resumable step so a quota error never loses a parsed
   document.
6. **Retrieve hybrid.** Cosine search over an HNSW index and an OR-lexeme Postgres full-text query run in
   parallel; the two rankings are fused with reciprocal rank fusion (k = 60). Weights and top-k are configurable.
7. **Answer with citations and tools.** Numbered passages go to `gemini-3.5-flash-lite` with rules: answer
   only from passages, cite `[n]`, say `NOT_IN_DOCUMENT` otherwise, never do arithmetic. Function calling
   exposes five calculators (EMI, totals, effective annual rate via IRR, sum, percent); the server runs them,
   validates arguments with Zod, returns validation errors to the model as data, and loops (max 4 rounds).
   `[n]` markers are resolved server-side to chunk, page range, clause and quote; markers outside the context
   are dropped; citation-free answers are flagged `grounded: false`.
8. **Structured analyses.** Extraction uses retrieval-targeted context (8 field-group queries, ≤40 chunks) and
   JSON-schema output derived from Zod; on validation failure it retries once with the issues, then salvages
   per field. Risk review is a regex pre-filter per category followed by one structured confirmation call.

## Privacy design

- Original files are never written to disk or the database. The browser renders its own copy.
- Identifiers are masked before chunking, so nothing identifying reaches Postgres or Gemini. The free Gemini
  tier states that content may be used to improve Google's products; masking is the response to that clause.
- The placeholder map lives only in the uploader's browser tab; the server unmasks nothing.
- Documents are addressed by random UUID, there is no listing endpoint, and a scheduled job deletes everything
  older than 24 hours. The operator can see masked chunks in the database and nothing else.
- Names and addresses are not masked (regex cannot do that reliably); the demo uses fictional documents.

## Evaluation

The corpus is generated from spec objects (`samples/src`), so the PDFs and the ground truth can never
disagree; CI regenerates them and diffs the bytes. Seven documents: five loan agreements in five heading
styles with fixed/floating/flat rates and different fee structures, a residential lease, and finance lecture
notes. The golden dataset (`eval/src/golden.ts`) has 59 questions: numeric, textual, calculator-dependent and
not-in-document, with expected pages resolved from the ground truth.

Metrics: retrieval recall@k and MRR (a hit is a retrieved chunk overlapping an expected page), answer
accuracy by type, citation accuracy, tool use when arithmetic is required, per-field extraction accuracy
against ground truth, contract-fact accuracy, and risk-flag precision/recall. The fast subset (~17 model
calls) runs on every pull request against `eval/thresholds.json`; the full suite with ablations runs weekly.
Embeddings for the corpus and queries are committed as a fixture, so runs cost no embedding quota.

### Results (full run, 2026-07-08, `gemini-3.5-flash-lite` + `gemini-embedding-001` 768d, top-k 8)

| Metric | Value |
|---|---|
| Retrieval recall@8 / recall@1 / MRR (hybrid) | 100% / 86.8% / 0.934 |
| Answer accuracy, all 59 questions | 100% |
| Numeric answer accuracy (46) | 100% |
| Citation accuracy (cited page ∈ expected pages) | 100% |
| Not-in-document questions answered as such (6) | 100% |
| Calculator used when arithmetic was needed (10) | 100% |
| Extraction field accuracy (13 fields × 5 loans) | 100% |
| Contract facts (lease, 8 checks) | 100% |
| Risk flags: recall / precision (6 documents, 28 expected) | 100% / 93.3% |

**Retrieval ablations** (53 questions with expected pages):

| Retriever | recall@1 | recall@4 | recall@8 | MRR |
|---|---|---|---|---|
| hybrid (RRF) | 86.8% | 100% | 100% | 0.934 |
| vector only | 96.2% | 98.1% | 98.1% | 0.972 |
| full-text only (OR-lexeme) | 73.6% | 90.6% | 96.2% | 0.824 |

| Chunk cap (tokens) | recall@1 | recall@8 | MRR | chunks/doc |
|---|---|---|---|---|
| 200 | 90.6% | 100% | 0.947 | 21.7 |
| 400 (default) | 86.8% | 100% | 0.934 | 17.6 |
| 800 | 86.8% | 100% | 0.934 | 17.3 |

What the numbers say, honestly:

- **Full-text search with AND semantics was useless** (28% recall@8 with `websearch_to_tsquery`); OR-ing the
  stemmed lexemes and letting `ts_rank_cd` reward overlap took it to 96%. That change came out of the first
  eval run.
- **On this corpus vector search alone is strong**, and hybrid trades a little top-1 precision for covering
  the tail: hybrid reaches 100% at k = 8 where vector-only misses one question. With top-k 8 that tail is what
  matters for the answer, which is why hybrid stays the default; on a corpus with more exact-token questions
  (section numbers, product codes) the gap would be wider.
- **Chunk size barely matters here** because the documents are short and clause-structured; 200 tokens edges
  ahead on MRR at the cost of more chunks per document.
- The **one risk-flag false positive** per run is a benign auto-debit clause (cancellable on notice) that the
  model still flags, and the home loan's 24% p.a. additional interest being called penal interest, which is
  arguable.
- The scores are high because the corpus is synthetic, well-formatted and small: this harness measures
  regressions and design choices, not real-world performance on scanned, messy PDFs.

Full report: `eval/reports/latest.md`.

## Free-tier constraints and what they forced

- Gemini free tier (measured for this project): chat 15 requests/min and 500/day; embeddings 100 texts/min —
  each chunk in a batch counts. The client paces itself with a token bucket per model, retries with backoff and
  honours Gemini's `retryDelay`, caches embeddings by content hash and repeated questions per document.
- Render free: 512 MB, sleeps after 15 minutes; the container idles at ~120 MB, processes one document at a
  time and has no cron, so cleanup is a GitHub Actions schedule calling a bearer-protected endpoint.
- Neon free: 0.5 GB, autosuspends after 5 minutes; `/health` never touches the database, pool size 4.
- Zero-model-call CI: integration tests use a fake client whose embeddings are feature-hashed bag-of-words,
  so retrieval tests exercise real ranking logic offline.

## Local setup

```
npm install
docker compose up -d                    # Postgres 16 + pgvector on :5432
cp .env.example .env                    # add GEMINI_API_KEY (Google AI Studio)
npm run migrate
npm run dev:server                      # http://localhost:8080
npm run dev:web                         # http://localhost:5173
```

Tests: `npm run test:unit` (no network, no database), `npm run test:integration -w apps/server` (Postgres,
LLM faked), `npm test` for everything. Evaluation: `npm run run:ci -w eval` (fast subset) or
`npm run run -w eval -- --ablations --export-fixture` (full; re-export the fixture when samples or golden
queries change). Local Node is 20; the server pins `pdfjs-dist` 5.6.205 (6.x needs Node 22), the web app pins
6.3.289 to match react-pdf, and `jsdom` is overridden to 26.

## Development conventions

- Nothing that leaves the server may contain PII. Masking runs on parsed pages before chunking, so the database
  and every model call only ever see placeholders; the placeholder map is returned to the browser once and never
  stored. Original files are never written anywhere.
- The model never does arithmetic. Every number comes from `packages/shared/src/finance`, exposed as
  function-calling tools and unit-tested against known values and an independent solver.
- Every answer, extracted field, fact, outline entry and risk flag carries a citation resolved by the server from
  the passage number; the model cannot invent a page. Retrieval finding nothing yields a refusal, not a guess.
- `/health` never touches the database (Neon autosuspends after 5 minutes). Pool size 4, one document at a time.
- Migrations are plain SQL under `apps/server/migrations`, never edited after commit; they run at container boot.
- Configuration comes only from environment variables validated by `apps/server/src/config.ts`.
- Errors are `{ error: { code, message, requestId } }` via `HttpError` / `IngestError` / `LlmError`.
- Integration tests run against a real pgvector with the LLM faked (feature-hashed embeddings); only the eval
  job calls Gemini. Numbers in this README come from `eval/reports/latest.md`, never typed by hand.

## Deployment

The API is a Docker image on Render's free plan (`render.yaml` blueprint: multi-stage build, esbuild bundle,
migrations at boot, ~120 MB idle), Postgres with pgvector on Neon's free plan (pooled connection string as
`DATABASE_URL`), the web app on Vercel (`vercel.json`; `VITE_API_URL` points at the API and the API's
`CORS_ORIGIN` points back), and GitHub Actions for what the free tiers lack: `cleanup.yml` calls the
bearer-protected `/internal/cleanup` every six hours (secrets `API_BASE_URL`, `CLEANUP_TOKEN`), `eval.yml` runs
the fast evaluation subset on pull requests and the full suite weekly (secret `GEMINI_API_KEY`), and `ci.yml` runs
typecheck, unit and integration tests and verifies the sample corpus is reproducible. Sentry is optional
(`SENTRY_DSN`). Verify a deployment with `node scripts/smoke.mjs <api-url> <web-url>`: cold start, database,
samples, a cited answer, extraction, the cleanup guard and the web app, at a cost of at most two model calls.

## Limitations

DOCX has no page numbers. Names and addresses are not masked. Heading detection is heuristic. The risk
catalogue is fifteen regex-prefiltered categories aimed at Indian retail lending and common consumer contracts.
The classifier is keyword-based. Chat is per document; comparison is loan-only. Cold starts on the free tier.
