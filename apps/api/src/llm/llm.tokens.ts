/** Injection token for the LlmClient (generation, not embeddings). Tests replace it with a fake, so they never call a real provider. */
export const LLM = Symbol("LLM");
