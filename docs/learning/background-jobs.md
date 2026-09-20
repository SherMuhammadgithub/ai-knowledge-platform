# Background jobs (Milestone 4)

An extra topic beyond the ten planned files. It extends `09-production-ai.md`: that note is about calling AI providers reliably, this one is about running slow work outside the web request.

## Concept

A job queue lets the web server hand slow work to a separate process. The upload returns at once with "Uploaded". A worker takes the job from the queue (BullMQ, stored in Redis), does the work, and records the result in the database. The screen shows the status changing.

## Why it matters

- Reading a file, and later embedding it, is slow and can be rate limited. Inside a web request it would time out, block other people, and vanish if the server restarted.
- Queues survive restarts. A job added while the worker is off waits in Redis and is done when the worker returns.
- Production AI work is mostly this: many slow, fallible steps with visible status.

## Mental model

```
browser -> API: upload   -> saves file + row (Uploaded) -> adds a job {documentId, workspaceId} -> answers 201
                                                                   |
                                            Redis queue  <---------+
                                                 |
                              worker process (separate, same codebase)
                                 loads the document through the workspace-scoped client
                                 Uploaded -> Processing -> Ready   (text saved)
                                                       \-> Failed  (with a reason)
browser: polls every 3 seconds while anything is Uploaded or Processing
```

## The two kinds of failure

| | Example | What happens |
|---|---|---|
| **Permanent** (a problem with the file) | damaged PDF, no text, too many pages, password protected, missing file | Failed at once, with a plain reason. Retrying cannot help. |
| **Temporary** (a problem with the system) | database hiccup, Redis blip, disk error | The queue retries: 3 attempts, waiting 5 s then 10 s. After the last one the document is Failed with "temporary problem, try again", and Retry is offered. |

Getting this split wrong costs something both ways. Retrying permanent errors wastes time and hides the real reason. Treating temporary errors as permanent fails documents for no reason.

## Safe to run twice

Queues usually deliver a job **at least once**, so duplicates happen: a retry after the work was done but before the worker reported it, the sweeper and the original job both firing, someone pressing Retry twice. The processor is built to be repeatable:

- A document that is already Ready is left alone.
- The pages and the "Ready" status are written **in one transaction**, replacing any earlier pages. A crash half way leaves nothing behind, and a re-run gives the same result.
- A document deleted while queued, or a job naming the wrong workspace, finds nothing and does nothing.

## The sweeper: the safety net

The API adds the job right after the upload. But Redis can be down at that moment, or the worker can die mid-job. The worker runs a sweeper every minute: any document still Uploaded or Processing after **5 minutes** is queued again. It needs to look across workspaces, so it uses `system-queries.ts`, the one place allowed to read tenant tables without a workspace. It returns ids only, and all real work still goes through the scoped client. A test fails if the plain client touches a tenant table anywhere else.

## What we implemented, and where

| Piece | File |
|---|---|
| Producer (adds jobs, fails fast if Redis is down) | `apps/api/src/queue/document-queue.service.ts` |
| Job shape and retry settings | `apps/api/src/queue/queue.constants.ts` |
| The processor: read, extract, save, mark Ready or Failed | `apps/api/src/processing/document-processor.service.ts` |
| The worker (Redis consumer) | `apps/api/src/worker/document.worker.ts` |
| The sweeper and its one cross-tenant query | `apps/api/src/worker/sweeper.service.ts`, `system-queries.ts` |
| Worker entry point (a second process) | `apps/api/src/worker.ts`, run with `bun run worker` |
| Retry action and text endpoint | `apps/api/src/documents/documents.service.ts` |
| Tests with a real worker and real Redis | `apps/api/test/processing.e2e.spec.ts` |

## Tradeoffs

- **At-least-once vs exactly-once.** Exactly-once delivery is not realistic. Repeatable jobs are.
- **Polling vs live push.** The screen asks every 3 seconds while something is in progress. Simple and enough here. Server-sent events would be smoother but more machinery.
- **One Redis, in memory.** Fine for a demo. Production wants Redis persistence and monitoring.
- **The rate limiter is per process.** When several workers exist, provider limits (Milestone 5) need to be shared through Redis.
- **Retry counts and waits are a guess.** 3 attempts, 5 seconds, doubling. Worth tuning against real failures.

## Common mistakes

- Doing the slow work inside the request.
- A job that assumes it runs once.
- Retrying errors that can never succeed.
- Adding the job before the database row exists, so the worker looks for something not there yet.
- No way to notice a job that never ran.
- Taking the workspace from anywhere but the server when the job is created.

## Interview questions

1. Why use a queue and a separate worker instead of processing during the upload request?
2. What does "at least once delivery" mean, and how do you design for it?
3. How do you decide whether a failed job should be retried?
4. What happens to a queued job if the worker or Redis is down, and how would you find jobs that never ran?
5. How do you keep multi-tenant rules in a worker that has no user session?

## Try it

1. Start the API, the web app and the worker. Upload `demo-files/facilities-guide.pdf` and watch the status change.
2. Stop the worker (Ctrl+C in its terminal). Upload a text file: it stays Uploaded. Start the worker again: it is processed straight away, because the job waited in Redis.
3. Stop the Redis container (`docker compose stop redis`), upload a file, then start Redis (`docker compose start redis`). Work out what recovers the document and about how long it takes.
