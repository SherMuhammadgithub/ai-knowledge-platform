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

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function statusOf(err: unknown): number | undefined {
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
