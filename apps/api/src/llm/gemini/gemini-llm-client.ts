import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type {
  GenerateRequest,
  GenerateResult,
  GenerateStreamChunk,
  LlmClient,
  ThinkingSetting,
  UsageSink,
} from "../types";
import { RateLimiter, withRetry } from "../resilience";

export type GeminiLlmOptions = {
  apiKey: string;
  model: string;
  maxRetries: number;
  limiter: RateLimiter;
  usage: UsageSink;
};

const THINKING: Record<ThinkingSetting, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

export class GeminiLlmClient implements LlmClient {
  private readonly ai: GoogleGenAI;
  readonly model: string;

  constructor(private readonly opts: GeminiLlmOptions) {
    this.ai = new GoogleGenAI({ apiKey: opts.apiKey });
    this.model = opts.model;
  }

  private configOf(request: GenerateRequest) {
    return {
      systemInstruction: request.system,
      temperature: request.temperature,
      maxOutputTokens: request.maxOutputTokens,
      thinkingConfig: { thinkingLevel: THINKING[request.thinking ?? "minimal"] },
    };
  }

  private recordUsage(started: number, attempts: number, result: Pick<GenerateResult, "inputTokens" | "outputTokens" | "thoughtTokens">, err?: unknown) {
    this.opts.usage.record({
      operation: "generate",
      provider: "gemini",
      model: this.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      thoughtTokens: result.thoughtTokens,
      latencyMs: Date.now() - started,
      attempts,
      ok: err === undefined,
      ...(err !== undefined ? { error: err instanceof Error ? err.message.slice(0, 200) : String(err) } : {}),
    });
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const started = Date.now();
    try {
      const { value: response, attempts } = await withRetry(
        async () => {
          await this.opts.limiter.acquire(); // every attempt counts against the quota
          return this.ai.models.generateContent({ model: this.model, contents: request.prompt, config: this.configOf(request) });
        },
        { maxRetries: this.opts.maxRetries },
      );

      const usage = response.usageMetadata;
      const result: GenerateResult = {
        text: response.text ?? "",
        model: this.model,
        inputTokens: usage?.promptTokenCount ?? null,
        outputTokens: usage?.candidatesTokenCount ?? null,
        thoughtTokens: usage?.thoughtsTokenCount ?? 0,
      };
      this.recordUsage(started, attempts, result);
      return result;
    } catch (err) {
      this.recordUsage(started, (err as { attempts?: number }).attempts ?? 1, { inputTokens: null, outputTokens: null, thoughtTokens: null }, err);
      throw err;
    }
  }

  /**
   * Retrying only covers opening the stream (the part wrapped in withRetry, below). Once the for-await loop
   * below has yielded a single piece of text to the caller, a failure is not retried: retrying would mean
   * starting a fresh answer while the caller has already shown part of the old one, duplicating text on screen.
   */
  async *generateStream(request: GenerateRequest): AsyncGenerator<GenerateStreamChunk, GenerateResult> {
    const started = Date.now();
    let attempts = 1;
    try {
      const { value: stream, attempts: openAttempts } = await withRetry(
        async () => {
          await this.opts.limiter.acquire();
          return this.ai.models.generateContentStream({ model: this.model, contents: request.prompt, config: this.configOf(request) });
        },
        { maxRetries: this.opts.maxRetries },
      );
      attempts = openAttempts;

      let text = "";
      let usage: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } | undefined;
      for await (const chunk of stream) {
        if (chunk.usageMetadata) usage = chunk.usageMetadata; // the last chunk carries the final, cumulative counts
        const delta = chunk.text ?? "";
        if (delta) {
          text += delta;
          yield { text: delta };
        }
      }

      const result: GenerateResult = {
        text,
        model: this.model,
        inputTokens: usage?.promptTokenCount ?? null,
        outputTokens: usage?.candidatesTokenCount ?? null,
        thoughtTokens: usage?.thoughtsTokenCount ?? 0,
      };
      this.recordUsage(started, attempts, result);
      return result;
    } catch (err) {
      this.recordUsage(started, attempts, { inputTokens: null, outputTokens: null, thoughtTokens: null }, err);
      throw err;
    }
  }
}
