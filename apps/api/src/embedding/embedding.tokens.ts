/** Injection token for the EmbeddingClient. Tests replace it with a fake, so they never call a real provider. */
export const EMBEDDINGS = Symbol("EMBEDDINGS");
