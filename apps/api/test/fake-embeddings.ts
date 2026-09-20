import { createHash } from "node:crypto";
import type { EmbedPurpose, EmbeddingClient } from "../src/llm/types";

export const DIMENSIONS = 768;

/** A word-count vector: texts that share words point the same way. Not smart, but deterministic and offline. */
export function fakeVector(text: string): number[] {
  const v = new Array<number>(DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    const bucket = createHash("sha256").update(word).digest().readUInt16BE(0) % DIMENSIONS;
    v[bucket] += 1;
  }
  const length = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  if (length === 0) v[0] = 1;
  return length === 0 ? v : v.map((x) => x / length);
}

/**
 * A stand-in for the real embedding provider. Tests use it everywhere, so no test ever calls a real service
 * (or sends any text anywhere). It records every call, and can be told to fail.
 */
export class FakeEmbeddingClient implements EmbeddingClient {
  readonly model = "fake-embedding";
  readonly dimensions = DIMENSIONS;
  /** Tests change this to simulate a new model or new wording. */
  setupId = "fake-embedding|768|w1";

  /** Every call: the texts, and what they were for. */
  calls: { texts: string[]; purpose: EmbedPurpose }[] = [];
  /** Errors to throw on the next calls, one per call, oldest first. */
  failures: unknown[] = [];
  /** Runs at the start of each call, for tests that want to look at the system mid-way. */
  beforeCall?: (call: { texts: string[]; purpose: EmbedPurpose }) => Promise<void> | void;

  async embed(texts: string[], purpose: EmbedPurpose): Promise<number[][]> {
    const call = { texts: [...texts], purpose };
    this.calls.push(call);
    await this.beforeCall?.(call);
    const failure = this.failures.shift();
    if (failure) throw failure;
    return texts.map(fakeVector);
  }

  /** All texts sent so far, in order. */
  get textsSent(): string[] {
    return this.calls.flatMap((c) => c.texts);
  }

  reset() {
    this.calls = [];
    this.failures = [];
    this.beforeCall = undefined;
    this.setupId = "fake-embedding|768|w1";
  }
}

/** An error that looks like a provider failure with an HTTP status (429 and 5xx are retryable, 400 and 401 are not). */
export const providerError = (status: number, message = `provider error ${status}`) =>
  Object.assign(new Error(message), { status });
