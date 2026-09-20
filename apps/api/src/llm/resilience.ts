// Free-tier survival kit: a client-side rate limiter and retry with exponential backoff + jitter.

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Sliding-window limiter: at most `maxPerMinute` calls in any 60s window.
 * Waits instead of failing, so callers just `await limiter.acquire()`.
 * In-process only. With several worker processes the limit must be shared (Redis), see M13.
 */
export class RateLimiter {
  private readonly stamps: number[] = [];

  constructor(private readonly maxPerMinute: number) {}

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      while (this.stamps.length && now - this.stamps[0] >= 60_000)
        this.stamps.shift();
      if (this.stamps.length < this.maxPerMinute) {
        this.stamps.push(now);
        return;
      }
      await sleep(60_000 - (now - this.stamps[0]) + 5);
    }
  }
}

/**
 * Sliding-window limiter for TOKENS: at most `maxPerMinute` tokens in any 60s window.
 * Embeddings are capped by tokens per minute (30K on the free tier), and that limit binds long before the request
 * limit does: a batch of 16 chunks is one request but thousands of tokens. Waits instead of failing.
 * In-process only, like RateLimiter. The clock and sleep are parameters so tests can run without waiting.
 */
export class TokenLimiter {
  private readonly entries: { at: number; tokens: number }[] = [];
  private used = 0;

  constructor(
    private readonly maxPerMinute: number,
    private readonly now: () => number = Date.now,
    private readonly wait: (ms: number) => Promise<void> = sleep,
  ) {}

  async acquire(tokens: number): Promise<void> {
    // A request bigger than the whole budget could never fit. Let it through once the window is empty.
    const cost = Math.min(Math.max(1, Math.ceil(tokens)), this.maxPerMinute);
    for (;;) {
      const now = this.now();
      while (this.entries.length && now - this.entries[0].at >= 60_000) this.used -= this.entries.shift()!.tokens;
      if (this.used + cost <= this.maxPerMinute) {
        this.entries.push({ at: now, tokens: cost });
        this.used += cost;
        return;
      }
      // Wait until enough of the oldest entries have left the window to make room.
      const needed = this.used + cost - this.maxPerMinute;
      let freed = 0;
      let until = now;
      for (const entry of this.entries) {
        freed += entry.tokens;
        until = entry.at + 60_000;
        if (freed >= needed) break;
      }
      await this.wait(Math.max(1, until - now) + 5);
    }
  }
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export function statusOf(err: unknown): number | undefined {
  const e = err as { status?: unknown; code?: unknown };
  if (typeof e?.status === "number") return e.status;
  if (typeof e?.code === "number") return e.code;
  return undefined;
}

export function isRetryable(err: unknown): boolean {
  const status = statusOf(err);
  if (status !== undefined) return RETRYABLE_STATUS.has(status);
  // No HTTP status usually means a network-level failure (reset, DNS, timeout).
  return (
    err instanceof TypeError ||
    /ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed/i.test(String(err))
  );
}

export type RetryResult<T> = { value: T; attempts: number };

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxRetries: number; baseDelayMs?: number; maxDelayMs?: number },
): Promise<RetryResult<T>> {
  const base = opts.baseDelayMs ?? 1_000;
  const cap = opts.maxDelayMs ?? 30_000;
  for (let attempt = 1; ; attempt++) {
    try {
      return { value: await fn(), attempts: attempt };
    } catch (err) {
      if (attempt > opts.maxRetries || !isRetryable(err)) {
        throw Object.assign(
          err instanceof Error ? err : new Error(String(err)),
          { attempts: attempt },
        );
      }
      // Full jitter: random delay up to the exponential ceiling, so parallel workers do not retry in lockstep.
      const ceiling = Math.min(cap, base * 2 ** (attempt - 1));
      await sleep(Math.random() * ceiling);
    }
  }
}
