// Token bucket sized to the free-tier RPM so the app paces itself instead of collecting 429s.
export class RateLimiter {
  private tokens: number;
  private lastRefill = Date.now();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    this.tokens = perMinute;
    this.lastRefill = now();
  }

  private refill() {
    const t = this.now();
    const elapsedMin = (t - this.lastRefill) / 60_000;
    this.tokens = Math.min(this.perMinute, this.tokens + elapsedMin * this.perMinute);
    this.lastRefill = t;
  }

  // Serialises callers so bursts are spread out rather than all sleeping then all firing.
  // `cost` is the number of quota units the call consumes: the embedding quota counts every text in
  // a batch, not the request, so a batch of 32 chunks costs 32.
  acquire(cost = 1): Promise<void> {
    const need = Math.min(Math.max(1, cost), this.perMinute);
    const next = this.queue.then(async () => {
      this.refill();
      if (this.tokens < need) {
        const waitMs = Math.ceil(((need - this.tokens) / this.perMinute) * 60_000);
        await this.sleep(waitMs);
        this.refill();
      }
      this.tokens -= need;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
}

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, delayMs: number, err: unknown) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  shouldRetry: (err: unknown) => { retry: boolean; retryAfterMs?: number },
  opts: RetryOptions,
): Promise<T> {
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      const decision = shouldRetry(err);
      if (!decision.retry || attempt >= opts.attempts) throw err;
      const backoff = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** (attempt - 1));
      const delay = Math.max(backoff, decision.retryAfterMs ?? 0) + Math.floor(Math.random() * 250);
      opts.onRetry?.(attempt, delay, err);
      await sleep(delay);
    }
  }
}
