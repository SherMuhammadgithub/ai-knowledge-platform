import { GoogleGenAI } from '@google/genai';
import type { EmbedPurpose, EmbeddingClient, UsageSink } from '../types';
import { RateLimiter, withRetry } from '../resilience';

export type GeminiEmbeddingOptions = {
  apiKey: string;
  model: string;
  dimensions: number;
  maxRetries: number;
  limiter: RateLimiter;
  usage: UsageSink;
};

const MAX_BATCH = 100;

export class GeminiEmbeddingClient implements EmbeddingClient {
  private readonly ai: GoogleGenAI;
  readonly model: string;
  readonly dimensions: number;

  constructor(private readonly opts: GeminiEmbeddingOptions) {
    this.ai = new GoogleGenAI({ apiKey: opts.apiKey });
    this.model = opts.model;
    this.dimensions = opts.dimensions;
  }

  async embed(texts: string[], purpose: EmbedPurpose): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH) {
      out.push(...(await this.embedBatch(texts.slice(i, i + MAX_BATCH), purpose)));
    }
    return out;
  }

  private async embedBatch(texts: string[], purpose: EmbedPurpose): Promise<number[][]> {
    const started = Date.now();
    // gemini-embedding-001 takes a taskType parameter. Per the docs, gemini-embedding-2 does not:
    // the task is written into the text instead. This branch is why the interface exposes intent only.
    const legacyTaskType = this.model.startsWith('gemini-embedding-001');
    const prepared = legacyTaskType ? texts : texts.map((t) => withInstruction(t, purpose));
    // Each text must be its own content entry. A plain string[] is treated as parts of ONE input, and
    // gemini-embedding-2 then returns a single merged vector for the whole array (verified 2026-09-19).
    const contents = prepared.map((text) => ({ parts: [{ text }] }));

    try {
      const { value: response, attempts } = await withRetry(async () => {
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

// Instruction wording follows the docs' guidance for asymmetric retrieval. Revisit in M5 by measuring.
function withInstruction(text: string, purpose: EmbedPurpose): string {
  return purpose === 'query'
    ? `task: search result | query: ${text}`
    : `title: none | text: ${text}`;
}
