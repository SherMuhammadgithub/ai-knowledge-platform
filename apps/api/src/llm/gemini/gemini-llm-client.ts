import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type {
  GenerateRequest,
  GenerateResult,
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

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const started = Date.now();
    try {
      const { value: response, attempts } = await withRetry(
        async () => {
          await this.opts.limiter.acquire(); // every attempt counts against the quota
          return this.ai.models.generateContent({
            model: this.model,
            contents: request.prompt,
            config: {
              systemInstruction: request.system,
              temperature: request.temperature,
              maxOutputTokens: request.maxOutputTokens,
              thinkingConfig: { thinkingLevel: THINKING[request.thinking ?? "minimal"] },
            },
          });
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
      this.opts.usage.record({
        operation: "generate",
        provider: "gemini",
        model: this.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        thoughtTokens: result.thoughtTokens,
        latencyMs: Date.now() - started,
        attempts,
        ok: true,
      });
      return result;
    } catch (err) {
      this.opts.usage.record({
        operation: "generate",
        provider: "gemini",
        model: this.model,
        inputTokens: null,
        outputTokens: null,
        thoughtTokens: null,
        latencyMs: Date.now() - started,
        attempts: (err as { attempts?: number }).attempts ?? 1,
        ok: false,
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
      throw err;
    }
  }
}
