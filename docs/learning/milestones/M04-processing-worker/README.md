# Milestone 4: processing worker

**Status:** built, tested (129 tests) and checked in a browser (2026-09-20). Only the quiz is open.

## Goal

Read every uploaded document automatically, in the background, and store clean text per page, with visible status and a plain reason when it fails.

## What was built

- BullMQ queue on Redis, and a separate worker process (`bun run worker`). The upload only saves the file and adds a job.
- Extraction: PDF page by page (pdfjs), Word (mammoth), text. Cleaning rules with tests: ligatures, invisible characters, split words, line joins, repeated headers and footers.
- Limits (300 pages, 60 seconds, 3 million characters, zip-bomb guard), permanent vs temporary failure, 3 retries, safe to run twice, sweeper for stuck documents.
- Text stored in Postgres, table `document_pages`, one row per page.
- Web: status with reason, live updates every 3 seconds, Retry, and the extracted-text panel.

## Read

- [`../../text-extraction.md`](../../text-extraction.md)
- [`../../background-jobs.md`](../../background-jobs.md)
- [`../../tenant-isolation.md`](../../tenant-isolation.md), section "Added in Milestone 4"
- `docs/DEMO_GUIDE.md`, checks N to P

## Quiz

`docs/learning/QUIZ.md`, section "Milestone 4" (6 questions, 3 exercises).

## Open

- Redis outage recovery by hand (exercise B).
- Quiz unanswered.
- Known gaps are listed in `docs/PROGRESS.md`: no OCR, PDF reading order for columns and tables, per-process rate limiter, worker started by hand.
