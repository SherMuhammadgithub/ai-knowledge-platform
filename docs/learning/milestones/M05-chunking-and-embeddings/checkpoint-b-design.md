# Checkpoint B design: chunks

Written 2026-09-20, before any code. Read it, change anything you disagree with, then say go.

## What Checkpoint B delivers

Each Ready document gets its pages cut into chunks, stored in Postgres, visible in the app. Nothing is sent to Gemini in this checkpoint. There are no embeddings yet.

## The table: `document_chunks`

Same conventions as `document_pages` (uuid v7 id, `workspace_id`, cascade delete, tenant table behind the scoped client).

| Column | Meaning |
|---|---|
| `workspace_id`, `document_id` | Owner. Workspace is always set by the server |
| `page_number` | The one page this chunk comes from (chunks never cross a page) |
| `chunk_index` | Order within the document, starting at 0 |
| `strategy` | `paragraph` or `fixed`. Lets Milestone 6 store both for the same document and compare them |
| `start_char`, `end_char` | Where the chunk sits inside that page's text. Invariant: `page.text.slice(start, end) === chunk.text` |
| `text` | A copy of the chunk text. Postgres is the source of truth, so vectors can always be rebuilt from it |
| `token_estimate` | `characters / 4` |
| `content_hash` | SHA-256 of the text. It becomes part of the embedding cache key in Checkpoint C |
| `created_at` | |

Unique on (`document_id`, `strategy`, `chunk_index`). Index on (`workspace_id`, `document_id`).

## The two chunkers

Both are plain functions with no database and no network, so they are easy to test. Settings come from `.env`: `CHUNK_TARGET_TOKENS=500`, `CHUNK_OVERLAP_TOKENS=60` (about 12%). Sizes are in estimated tokens (characters / 4), so about 2,000 characters per chunk and about 240 characters of overlap.

**`fixed` (the naive one).** Cut every 2,000 characters, start the next chunk 240 characters earlier. It ignores words, sentences and paragraphs. It exists so you can see what naive chunking does to a page, and as the baseline for Milestone 6.

**`paragraph` (the production style).** In order:

1. Work on one page at a time.
2. Split the page into paragraphs (blank lines).
3. Pack whole paragraphs into a chunk until the next one would go over the target.
4. A paragraph that is longer than the target is split into sentences (`Intl.Segmenter`, built into Node, no new package). Sentences are packed the same way.
5. A single sentence that is still too long is cut at a word boundary. This is the last resort.
6. Overlap: the next chunk starts with the last sentences of the previous one, up to the overlap size. Only when the page needed more than one chunk. A page that fits in one chunk has none.
7. A tiny leftover at the end (under 15% of the target) is merged into the previous chunk instead of standing alone.
8. Empty and blank pages produce no chunks.

**Known costs.** Sentence splitting is a heuristic: unusual abbreviations can be split wrongly. Tables and lists come out as plain text, so a table row can end up in the wrong chunk. A sentence that crosses a page break is cut at the break (our decision from the plan).

## Where it runs

In the processor (`apps/api/src/processing/`), in the same transaction that saves the pages and marks the document Ready. So "Ready" means pages and chunks both exist, or neither does. Running it twice replaces the old chunks, like pages. In Checkpoint C this same spot will mark the document Indexing and queue the embedding job instead.

Documents that are already Ready (the demo data, anything uploaded before now) have no chunks. A script, `bun run chunks:rebuild`, cuts chunks for them from the stored pages without reading the files again. It is also what we will use in Milestone 6 to switch strategy. The seed calls the same code for its sample documents.

## What you will see

- A Ready row says "3 pages, 5 chunks".
- The text panel gets two tabs: **Pages** (as now) and **Chunks**. Each chunk is a block headed "Chunk 4, page 2, about 420 tokens". The overlapping part is shown in a muted tint and labelled, so you see exactly what is repeated. (The yellow highlight stays reserved for citations, per the frontend rules.)
- New endpoint `GET /documents/:id/chunks`, same permission as reading pages, workspace from the session.

## Tests

- Chunker (pure): `text.slice(start, end)` equals the chunk text for every chunk. No chunk exceeds the hard limit. No empty chunk. Paragraphs that fit are never split. Long paragraph splits at sentences. Very long sentence splits at a word. Overlap is present between neighbours and absent on a one-chunk page. Tiny tail is merged. Same input gives the same output. `fixed` does cut mid-word (documented as the baseline).
- Table: it is registered as a tenant table, and a chunk written with another workspace's id lands in the caller's (same tests as pages). The guard test still finds no plain-client use outside the allowed files.
- Processor: chunks are saved with the pages, a second run replaces them, a failed chunk save rolls back the pages and the Ready status.
- Endpoint: another workspace's document returns 404.
- Mutation checks as in Milestone 4: break the offset, break the overlap, drop the workspace scope, then confirm tests go red.

## Files

`apps/api/src/chunking/` (`fixed.ts`, `paragraph.ts`, `index.ts`, settings), `apps/api/prisma/schema.prisma` and a migration, `apps/api/src/prisma/tenant-client.ts` (register the table), `apps/api/src/processing/document-processor.service.ts`, `apps/api/src/documents/` (endpoint), `apps/api/src/scripts/chunks-rebuild.ts`, `apps/api/src/scripts/seed.ts`, `apps/web` (tabs component, chunks view, row text), `apps/api/test/`.
