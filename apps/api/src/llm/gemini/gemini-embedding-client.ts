import { createHash } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import type { EmbedPurpose, EmbeddingClient, UsageSink } from '../types';
import { RateLimiter, TokenLimiter, withRetry } from '../resilience';
import { estimateTokensForLimiter } from '../tokens';

export type GeminiEmbeddingOptions = {
  apiKey: string;
  model: string;
  dimensions: number;
  maxRetries: number;
  limiter: RateLimiter;
  tokenLimiter: TokenLimiter;
  usage: UsageSink;
};

// A call holds at most this many texts, and at most this many (estimated) tokens. Small enough that one call
// never takes a big share of the per-minute budget, and that a failure loses little.
const MAX_BATCH = 100;
const MAX_BATCH_TOKENS = 10_000;

export class GeminiEmbeddingClient implements EmbeddingClient {
  private readonly ai: GoogleGenAI;
  readonly model: string;
  readonly dimensions: number;
  readonly setupId: string;

  constructor(private readonly opts: GeminiEmbeddingOptions) {
    this.ai = new GoogleGenAI({ apiKey: opts.apiKey });
    this.model = opts.model;
    this.dimensions = opts.dimensions;
    // The wording id is a fingerprint of the instruction text itself, so editing withInstruction() below
    // changes the setup id by itself. Nobody has to remember to bump a version number.
    this.setupId = `${opts.model}|${opts.dimensions}|${wordingId(this.usesTaskType)}`;
  }

  // gemini-embedding-001 takes a taskType parameter. Per the docs, gemini-embedding-2 does not:
  // the task is written into the text instead. This is why the interface exposes intent only.
  private get usesTaskType() {
    return this.opts.model.startsWith('gemini-embedding-001');
  }

  async embed(texts: string[], purpose: EmbedPurpose): Promise<number[][]> {
    const out: number[][] = [];
    for (const batch of this.splitIntoBatches(texts)) {
      out.push(...(await this.embedBatch(batch, purpose)));
    }
    return out;
  }

  private splitIntoBatches(texts: string[]): string[][] {
    const batches: string[][] = [];
    let current: string[] = [];
    let tokens = 0;
    for (const text of texts) {
      const cost = estimateTokensForLimiter(text);
      if (current.length && (current.length >= MAX_BATCH || tokens + cost > MAX_BATCH_TOKENS)) {
        batches.push(current);
        current = [];
        tokens = 0;
      }
      current.push(text);
      tokens += cost;
    }
    if (current.length) batches.push(current);
    return batches;
  }

  private async embedBatch(texts: string[], purpose: EmbedPurpose): Promise<number[][]> {
    const started = Date.now();
    const legacyTaskType = this.usesTaskType;
    const prepared = legacyTaskType ? texts : texts.map((t) => withInstruction(t, purpose));
    // Each text must be its own content entry. A plain string[] is treated as parts of ONE input, and
    // gemini-embedding-2 then returns a single merged vector for the whole array (verified 2026-09-19).
    const contents = prepared.map((text) => ({ parts: [{ text }] }));
    // The budget is in tokens per minute. The text sent includes the instruction, so count that text.
    const estimatedTokens = prepared.reduce((sum, text) => sum + estimateTokensForLimiter(text), 0);

    try {
      const { value: response, attempts } = await withRetry(async () => {
        // Every attempt spends budget, retries included, so both limiters sit inside the retry.
        await this.opts.tokenLimiter.acquire(estimatedTokens);
        await this.opts.limiter.acquire();
        return this.ai.models.embedContent({
          model: this.model,
          contents,
          config: {
            outputDimensionality: this.dimensions,
            ...(legacyTaskType && {
              taskType: purpose === 'document' ? 'RETRIEVAL_DOCUMENT' : 'RETRIEVAL_QUERY',
            }),
          },
        });
      }, { maxRetries: this.opts.maxRetries });

      const vectors = (response.embeddings ?? []).map((e) => e.values ?? []);
      if (vectors.length !== texts.length) {
        throw new Error(`Expected ${texts.length} embeddings, got ${vectors.length}`);
      }
      for (const v of vectors) {
        if (v.length !== this.dimensions) {
          throw new Error(`Expected ${this.dimensions} dimensions, got ${v.length}`);
        }
      }
      this.opts.usage.record({
        operation: 'embed', provider: 'gemini', model: this.model,
        inputTokens: null, outputTokens: null, thoughtTokens: null, // the embed endpoint does not report token counts
        latencyMs: Date.now() - started, attempts, ok: true,
      });
      return vectors;
    } catch (err) {
      this.opts.usage.record({
        operation: 'embed', provider: 'gemini', model: this.model,
        inputTokens: null, outputTokens: null, thoughtTokens: null,
        latencyMs: Date.now() - started,
        attempts: (err as { attempts?: number }).attempts ?? 1,
        ok: false, error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
      throw err;
    }
  }
}

// Instruction wording follows the docs' guidance for asymmetric retrieval. Not tuned yet: Milestone 6 compares
// wordings with real retrieval numbers. Changing it changes wordingId(), so cached vectors are not reused.
function withInstruction(text: string, purpose: EmbedPurpose): string {
  return purpose === 'query'
    ? `task: search result | query: ${text}`
    : `title: none | text: ${text}`;
}

// A short fingerprint of how texts are worded for the model. See setupId.
function wordingId(usesTaskType: boolean): string {
  const wording = usesTaskType
    ? 'taskType'
    : [withInstruction('x', 'document'), withInstruction('x', 'query')].join('\n');
  return createHash('sha256').update(wording).digest('hex').slice(0, 8);
}
