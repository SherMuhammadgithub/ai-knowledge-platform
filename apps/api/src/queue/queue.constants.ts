export const DOCUMENT_QUEUE_NAME = "document-processing";
// A second queue for embedding. It has its own worker with one job at a time: embedding is limited by the
// provider's tokens per minute, so a long embedding job must not hold up the reading of other documents.
export const EMBEDDING_QUEUE_NAME = "document-embedding";

/**
 * What a job carries. Both ids are set by the server when the job is created (after the upload was
 * authorised), never taken from anything a user typed. The worker loads the document through the scoped
 * client with this workspaceId, so a wrong pair simply finds nothing.
 */
export type DocumentJob = { documentId: string; workspaceId: string };

// Temporary problems are retried with growing waits (5s, then 10s). Jobs that finished are removed,
// and the last 200 failed ones are kept so they can be inspected.
export const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5_000 },
  removeOnComplete: true,
  removeOnFail: { count: 200 },
};

// Embedding retries wait longer: a rate-limit failure needs a minute or more to clear. Vectors already saved are
// kept, so a retry only does the remaining work.
export const EMBEDDING_JOB_OPTIONS = {
  ...JOB_OPTIONS,
  backoff: { type: "exponential" as const, delay: 30_000 },
};
