// Limits that protect the worker from files built to be expensive. Uploaded files are untrusted.
export type ProcessingLimits = {
  /** PDFs with more pages are refused. */
  maxPages: number;
  /** Wall-clock budget for reading one document, checked between pages. */
  timeoutMs: number;
  /** Cleaned text above this is refused. Protects the database and later steps. */
  maxChars: number;
  /** A DOCX is a zip. Refuse it if it would expand to more than this (a "zip bomb"). */
  maxUncompressedBytes: number;
  maxZipEntries: number;
};

export const DEFAULT_LIMITS: ProcessingLimits = {
  maxPages: 300,
  timeoutMs: 60_000,
  maxChars: 3_000_000,
  maxUncompressedBytes: 100 * 1024 * 1024,
  maxZipEntries: 2_000,
};
