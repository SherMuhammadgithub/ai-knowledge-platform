/**
 * A problem with the document itself: it is damaged, has no text, is too big, needs a password.
 * Trying again will not change the outcome, so the job fails at once and the reason (plain language,
 * written for the person who uploaded the file) is shown next to the document.
 *
 * Anything else that goes wrong (database hiccup, Redis, a file read) is treated as temporary and retried.
 */
export class PermanentProcessingError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "PermanentProcessingError";
  }
}
