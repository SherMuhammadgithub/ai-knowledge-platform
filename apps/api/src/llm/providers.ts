import type { Env } from "../config/env";
import { GeminiEmbeddingClient } from "./gemini/gemini-embedding-client";
import { GeminiLlmClient } from "./gemini/gemini-llm-client";
import { RateLimiter, TokenLimiter } from "./resilience";
import {
  ConsoleUsageSink,
  type EmbeddingClient,
  type LlmClient,
  type UsageSink,
} from "./types";

// The single place that picks a provider. Swapping providers means changing this function.
// Free-tier quotas are per model, so generation and embeddings each get their own limiter.
// Embeddings also get a tokens-per-minute budget (30K on the free tier), which binds before the request limit.
// Still to do: share the limiters through Redis when several processes call the provider (M13).
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
      tokenLimiter: new TokenLimiter(env.GEMINI_EMBEDDING_TPM),
      usage,
    }),
  };
}
