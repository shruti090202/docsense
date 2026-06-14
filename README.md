# DocSense

Loan and contract intelligence for Indian loan agreements: upload a PDF or DOCX and get structured terms with
citations, a deterministic true-cost calculation, risk flags, cited Q&A and side-by-side offer comparison.

Educational portfolio project. Not financial or legal advice.

Full documentation (architecture, RAG pipeline, privacy design, evaluation results, deployment) is written
as the remaining components land.

## Local setup
```
npm install
docker compose up -d
cp .env.example .env
npm run migrate
npm run test:unit
```
