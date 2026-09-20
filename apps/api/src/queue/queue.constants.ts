export const DOCUMENT_QUEUE_NAME = "document-processing";

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
