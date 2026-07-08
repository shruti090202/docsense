#!/usr/bin/env node
// Smoke test against a deployed stack: node scripts/smoke.mjs <api-url> [web-url]
// Costs at most two Gemini calls (one question; extraction only if the sample was never analysed).

const [api, web] = process.argv.slice(2).map((u) => u?.replace(/\/$/, ''));
if (!api) {
  console.error('usage: node scripts/smoke.mjs <api-url> [web-url]');
  process.exit(2);
}

let failures = 0;
async function step(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    console.log(`ok   ${name} (${Date.now() - started} ms)${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    failures += 1;
    console.log(`FAIL ${name} — ${err.message}`);
  }
}

async function json(url, init) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${res.status} ${body?.error?.code ?? ''} ${body?.error?.message ?? ''}`.trim());
  return body;
}

await step('health (may take a minute on a cold start)', async () => {
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      const h = await json(`${api}/health`);
      return `version ${h.version}, chat ${h.models.chat}`;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
});

await step('database reachable', async () => {
  const h = await json(`${api}/health/db`);
  if (h.status !== 'ok') throw new Error(JSON.stringify(h));
});

let documentId;
await step('samples listed', async () => {
  const samples = await json(`${api}/api/samples`);
  if (!Array.isArray(samples) || samples.length < 7) throw new Error(`got ${samples?.length} samples`);
  return `${samples.length} samples`;
});

await step('sample loads and embeds', async () => {
  const doc = await json(`${api}/api/samples/personal-loan-fixed/load`, { method: 'POST' });
  if (doc.status !== 'embedded') throw new Error(`status ${doc.status}`);
  if (!doc.piiMap['[PAN_1]']) throw new Error('no PII map');
  documentId = doc.documentId;
  return `${doc.chunkCount} chunks, kind ${doc.kind}`;
});

await step('cited answer', async () => {
  const res = await json(`${api}/api/documents/${documentId}/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'What is the EMI amount stated in the agreement?' }),
  });
  if (!/17,?088/.test(res.answer)) throw new Error(`unexpected answer: ${res.answer.slice(0, 120)}`);
  if (!res.citations.length) throw new Error('no citations');
  return `${res.citations.length} citation(s), cached=${res.cached}`;
});

await step('extraction and cost', async () => {
  const res = await json(`${api}/api/documents/${documentId}/extract`, { method: 'POST' });
  if (res.kind !== 'loan' || !res.cost?.cost) throw new Error('no cost summary');
  return `EAR ${res.cost.cost.effectiveAnnualRatePercent}%`;
});

await step('cleanup endpoint is protected', async () => {
  const res = await fetch(`${api}/internal/cleanup`, { method: 'POST' });
  if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
});

if (web) {
  await step('web app serves', async () => {
    const res = await fetch(web);
    const html = await res.text();
    if (!res.ok || !html.includes('DocSense')) throw new Error(`status ${res.status}`);
  });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
