import { describe, expect, it } from 'vitest';
import { hashEmbedding } from '../../src/llm/fake.js';
import { normalise } from '../../src/llm/gemini.js';
import { RateLimiter, withRetry } from '../../src/llm/throttle.js';
import { embeddingCacheKey } from '../../src/retrieval/embeddings.js';
import { reciprocalRankFusion } from '../../src/retrieval/rrf.js';

describe('reciprocalRankFusion', () => {
  it('scores by 1/(k+rank) summed across lists', () => {
    const fused = reciprocalRankFusion([
      { ids: ['a', 'b', 'c'], weight: 1, source: 'vector' },
      { ids: ['c', 'a', 'd'], weight: 1, source: 'text' },
    ]);
    expect(fused.map((f) => f.id)).toEqual(['a', 'c', 'b', 'd']);
    expect(fused[0]!.score).toBeCloseTo(1 / 61 + 1 / 62, 10);
    expect(fused[0]!.ranks).toEqual({ vector: 1, text: 2 });
    expect(fused[3]!.ranks).toEqual({ text: 3 });
  });

  it('a document found by both retrievers outranks one found by only one at a better rank', () => {
    const fused = reciprocalRankFusion([
      { ids: ['only-vector', 'both'], weight: 1, source: 'vector' },
      { ids: ['x', 'both'], weight: 1, source: 'text' },
    ]);
    expect(fused[0]!.id).toBe('both');
  });

  it('applies weights and ignores zero-weight lists', () => {
    const fused = reciprocalRankFusion([
      { ids: ['a'], weight: 0.5, source: 'vector' },
      { ids: ['b'], weight: 1, source: 'text' },
      { ids: ['z'], weight: 0, source: 'ignored' },
    ]);
    expect(fused.map((f) => f.id)).toEqual(['b', 'a']);
    expect(fused[0]!.score).toBeCloseTo(1 / 61, 10);
    expect(fused[1]!.score).toBeCloseTo(0.5 / 61, 10);
  });

  it('is deterministic on ties', () => {
    const fused = reciprocalRankFusion([{ ids: ['b'], weight: 1, source: 'v' }, { ids: ['a'], weight: 1, source: 't' }]);
    expect(fused.map((f) => f.id)).toEqual(['a', 'b']);
  });

  it('handles empty input', () => {
    expect(reciprocalRankFusion([])).toEqual([]);
    expect(reciprocalRankFusion([{ ids: [], weight: 1, source: 'v' }])).toEqual([]);
  });
});

describe('hashEmbedding', () => {
  it('is unit length, deterministic and rewards lexical overlap', () => {
    const a = hashEmbedding('prepayment charges of 4% of the principal outstanding', 256);
    const b = hashEmbedding('prepayment charge 4% principal outstanding', 256);
    const c = hashEmbedding('the arbitrator shall be appointed by the lender', 256);
    const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i]!, 0);
    expect(dot(a, a)).toBeCloseTo(1, 6);
    expect(hashEmbedding('prepayment charges of 4% of the principal outstanding', 256)).toEqual(a);
    expect(dot(a, b)).toBeGreaterThan(dot(a, c));
  });

  it('ignores redaction placeholders', () => {
    expect(hashEmbedding('PAN [PAN_1] borrower', 64)).toEqual(hashEmbedding('PAN [PAN_2] borrower', 64));
  });
});

describe('normalise', () => {
  it('scales vectors to unit length and leaves zero vectors alone', () => {
    expect(normalise([3, 4])).toEqual([0.6, 0.8]);
    expect(normalise([0, 0])).toEqual([0, 0]);
  });
});

describe('embeddingCacheKey', () => {
  it('changes with model, dimensions, task type and text', () => {
    const base = embeddingCacheKey('m', 768, 'RETRIEVAL_DOCUMENT', 'hello');
    expect(embeddingCacheKey('m', 768, 'RETRIEVAL_DOCUMENT', 'hello')).toBe(base);
    expect(embeddingCacheKey('m2', 768, 'RETRIEVAL_DOCUMENT', 'hello')).not.toBe(base);
    expect(embeddingCacheKey('m', 1536, 'RETRIEVAL_DOCUMENT', 'hello')).not.toBe(base);
    expect(embeddingCacheKey('m', 768, 'RETRIEVAL_QUERY', 'hello')).not.toBe(base);
    expect(embeddingCacheKey('m', 768, 'RETRIEVAL_DOCUMENT', 'hello ')).not.toBe(base);
  });
});

describe('RateLimiter', () => {
  it('lets a full bucket through immediately and then paces to the configured rate', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const limiter = new RateLimiter(6, () => now, async (ms) => {
      sleeps.push(ms);
      now += ms;
    });
    for (let i = 0; i < 6; i++) await limiter.acquire();
    expect(sleeps).toEqual([]);
    await limiter.acquire();
    expect(sleeps).toEqual([10_000]);
    now += 60_000;
    await limiter.acquire();
    expect(sleeps).toEqual([10_000]);
  });
});

describe('withRetry', () => {
  it('retries retryable errors with backoff and honours retry-after hints', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw Object.assign(new Error('busy'), { status: 429 });
        return 'ok';
      },
      (err) => ((err as { status?: number }).status === 429 ? { retry: true, retryAfterMs: 5000 } : { retry: false }),
      { attempts: 4, baseDelayMs: 1000, maxDelayMs: 8000, sleep: async (ms) => void sleeps.push(ms) },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(sleeps).toHaveLength(2);
    expect(sleeps.every((s) => s >= 5000 && s < 5250)).toBe(true);
  });

  it('gives up after the configured attempts and does not retry non-retryable errors', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw Object.assign(new Error('busy'), { status: 503 });
        },
        () => ({ retry: true }),
        { attempts: 3, baseDelayMs: 1, maxDelayMs: 2, sleep: async () => undefined },
      ),
    ).rejects.toThrow('busy');
    expect(calls).toBe(3);

    calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw Object.assign(new Error('bad request'), { status: 400 });
        },
        () => ({ retry: false }),
        { attempts: 3, baseDelayMs: 1, maxDelayMs: 2, sleep: async () => undefined },
      ),
    ).rejects.toThrow('bad request');
    expect(calls).toBe(1);
  });
});
