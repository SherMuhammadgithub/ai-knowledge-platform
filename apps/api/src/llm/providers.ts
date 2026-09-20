import type { Env } from "../config/env";
import { GeminiEmbeddingClient } from "./gemini/gemini-embedding-client";
import { GeminiLlmClient } from "./gemini/gemini-llm-client";
import { RateLimiter } from "./resilience";
import {
  ConsoleUsageSink,
  type EmbeddingClient,
  type LlmClient,
  type UsageSink,
} from "./types";

// The single place that picks a provider. Swapping providers means changing this function.
// Free-tier quotas are per model, so generation and embeddings each get their own limiter.
// Still to do: a tokens-per-minute budget (embeddings are capped at 30K TPM) in M5, and a shared
// Redis-backed limiter once the worker runs as a separate process in M4 and M13.
export function createProviders(
  env: Env,
  usage: UsageSink = new ConsoleUsageSink(),
): {
  llm: LlmClient;
  embeddings: EmbeddingClient;
} {
  return {
    llm: new GeminiLlmClient({
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_GENERATION_MODEL,
      maxRetries: env.GEMINI_MAX_RETRIES,
      limiter: new RateLimiter(env.GEMINI_GENERATION_RPM),
      usage,
    }),
    embeddings: new GeminiEmbeddingClient({
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_EMBEDDING_MODEL,
      dimensions: env.EMBEDDING_DIMENSIONS,
      maxRetries: env.GEMINI_MAX_RETRIES,
      limiter: new RateLimiter(env.GEMINI_EMBEDDING_RPM),
      usage,
    }),
  };
}
