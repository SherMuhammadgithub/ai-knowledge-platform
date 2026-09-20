# Checkpoint B results (2026-09-20)

Chunks now exist in Postgres and can be inspected in the app. Nothing was sent to Gemini in this checkpoint.

## What was built

| Piece | Where |
|---|---|
| Table `document_chunks` (tenant table, migration `document_chunks`) | `apps/api/prisma/schema.prisma` |
| Two chunkers: `fixed` (naive) and `paragraph` (production style) | `apps/api/src/chunking/fixed.ts`, `paragraph.ts`, `index.ts`, `settings.ts` |
| Save step (replaces old chunks, optionally one strategy only) | `apps/api/src/chunking/save-chunks.ts` |
| Chunking inside the processor, in the same transaction as pages and Ready | `apps/api/src/processing/document-processor.service.ts` |
| Endpoint `GET /documents/:id/chunks` and a `chunkCount` on every document | `apps/api/src/documents/` |
| Settings `CHUNK_STRATEGY`, `CHUNK_TARGET_TOKENS`, `CHUNK_OVERLAP_TOKENS` | `apps/api/src/config/env.ts`, `.env.example` |
| `bun run --cwd apps/api chunks:rebuild` for documents that are already Ready | `apps/api/src/scripts/chunks-rebuild.ts` |
| Seed cuts chunks for its sample documents with the same chunker | `apps/api/src/scripts/seed.ts` |
| Chunks tab in the text panel, chunk count in the document row | `apps/web/src/components/document-chunks-panel.tsx`, `document-text-sheet.tsx`, `documents-view.tsx` |
| A longer sample file, `demo-files/equipment-policy.txt`, made for seeing chunk cuts | `bun run samples` |

## The two chunkers on the same text

Input: `demo-files/equipment-policy.txt`, 5,578 characters, twenty short paragraphs. Target 2,000 characters (500 tokens), overlap 240 characters (60 tokens). Measured by running the real chunkers.

| | `paragraph` | `fixed` |
|---|---|---|
| Chunks | 4 | 4 |
| Sizes (characters) | 1749, 1777, 1910, 731 | 2000, 2000, 2000, 298 |
| Where chunks end | at paragraph ends ("...before booking.", "...next to the kitchen.") | anywhere ("...until their host confir", "...never propped open. Th") |
| Where chunks start | 2 whole sentences from the previous chunk | anywhere ("rs. Every visitor must be...") |
| Overlap | 184, 208, 197 characters, whole sentences | 240 characters, cuts words |

`fixed` splits "confirms" in two, and the second half of a split sentence lands in the next chunk without its start. A question about visitors might retrieve a chunk beginning "rs. Every visitor...". Milestone 6 measures whether this actually hurts retrieval. Do not assume it does.

## What you can see in the app

1. Sign in as Alice. Rows for Ready documents say for example "644 characters, 1 chunk".
2. Upload `demo-files/equipment-policy.txt`. Its row says "5,578 characters, 4 chunks" once the worker has the new code (see below).
3. Click the file name. Two tabs: **Pages** (what was read) and **Chunks 4**.
4. In **Chunks**: each chunk is a block with its number, its estimated size, and, from chunk 2, a line "Starts with 184 characters repeated from chunk 1." The repeated text is tinted. Scroll to where chunk 1 ends and chunk 2 begins: the same two sentences appear at the end of one and the start of the other.

Checked in headless Chrome: light and dark themes, 390 px width with no sideways scroll, keyboard switching between tabs with the arrow keys, and no console warnings.

## Costs and surprises found while building

- **Overlap is made of whole sentences.** If every sentence is longer than the overlap size, a chunk gets no overlap. Our tests show it (overlap 40 characters, sentences 57 characters). At the real setting (240 characters) typical sentences fit, but a page of very long sentences would get none.
- **Chunks are not all the same size.** The paragraph chunker prefers not to cut a short paragraph, so sizes range from 731 to 1910 characters here. That is the price of keeping paragraphs whole.
- **A real bug found by a random test.** Moving a break back to a paragraph start could produce a chunk that added nothing new to the one before it. Hand-written tests missed it. A test that generates 300 random pages under four size settings, for both chunkers, found it, and the fix has its own deliberate-break check.
- **Sentence splitting is a heuristic** (`Intl.Segmenter`). Unusual abbreviations can still be cut wrongly.

## Tests

- 161 API tests, all passing (32 new): 20 for the chunkers (including the random test), 10 with the real database (chunks saved with pages, replaced on a re-run, rolled back together with pages if saving fails, the endpoint, deletion, isolation between workspaces), and one more tenant-isolation test for the chunk table.
- The guard test that looks for plain-database-client use on tenant tables now covers the chunk table automatically.
- 10 deliberate breaks were all caught: wrong offsets, no overlap, the redundant-chunk bug, no tail merge, no fixed overlap, unscoped chunk table, no delete before save, replacing every strategy, saving outside the transaction, and a plain-client read of the chunk table.

## What is not verified yet

- **The real worker path in the browser.** The worker process running on your machine started before this code, so it does not chunk yet. The database-level tests exercise the same processor code, and the browser check used the rebuild script to cut chunks. After you restart the worker (`Ctrl+C`, then `bun run worker`), uploading a file should show its chunk count straight away. I will confirm that with you or with a browser run.

## Questions for you

1. **Restart the worker** so new uploads are chunked. Any document you already have is chunked (the rebuild script ran on your dev data).
2. **Compare strategies in the app?** A small toggle in the Chunks tab, paragraph vs fixed, would let you flip between the two cuts of the same document. It needs the fixed chunks stored too. I suggest doing it at the start of Milestone 6, where the comparison is the point. Say if you want it now.
3. **Before Checkpoint C:** it sends chunk text to Gemini's free tier to make embeddings. Your workspace holds two resume files. Delete them first, or tell me to exclude them.
4. **Go for Checkpoint C** (embedding cache, token limiter, embedding job, Indexing status, search check)?

## Optional exercises

1. In `.env` set `CHUNK_TARGET_TOKENS=150` and `CHUNK_OVERLAP_TOKENS=20`, run `bun run --cwd apps/api chunks:rebuild`, and look at the Chunks tab again. What changes in count and in the sentences that get repeated?
2. Open `http://localhost:3000/api/documents/<id>/chunks?strategy=fixed` for a document after `bun run --cwd apps/api chunks:rebuild --strategy fixed`. Which chunk boundaries would give a wrong answer to a question about that document?
