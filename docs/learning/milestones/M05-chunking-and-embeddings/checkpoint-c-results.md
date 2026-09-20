# Checkpoint C results (2026-09-20)

Documents now become searchable. This is the end of Milestone 5.

## What was built

```
upload -> [reading worker] Processing: read, clean, chunk        -> status Indexing, embedding job queued
       -> [embedding worker] Indexing: cache lookup, provider calls, save vectors, progress   -> status Ready
question -> query vector -> cosine against the workspace's chunk vectors -> top matches
```

| Piece | Where |
|---|---|
| Cache and vector table `chunk_embeddings`, `embedded_with` on chunks, status `INDEXING` (migration `embeddings`) | `apps/api/prisma/schema.prisma` |
| Token-per-minute limiter, token-aware batching, budget spent on every attempt, setup id | `apps/api/src/llm/`, `gemini-embedding-client.ts` |
| Embedding step (cache, groups of 16, saved after each group) | `apps/api/src/embedding/chunk-embedder.ts` |
| Worker step (Indexing to Ready, progress text, retries, permanent errors) | `apps/api/src/embedding/document-indexer.service.ts` |
| Second queue and second worker (one job at a time) | `apps/api/src/queue/`, `apps/api/src/worker/` |
| Sweeper handles a stuck Indexing document | `apps/api/src/worker/sweeper.service.ts` |
| Plain search and cosine | `apps/api/src/search/` |
| Deleting a document deletes its vectors (not ones another document uses) | `apps/api/src/documents/documents.service.ts` |
| `bun run --cwd apps/api embed:backfill`, `bun run --cwd apps/api search` | `apps/api/src/scripts/` |
| UI: Indexing status with progress, "searchable" rows, vector status in the Chunks tab | `apps/web/src/components/` |

## Real runs (Gemini, fictional sample text only)

- **Backfill:** 9 texts sent in 7 calls for the 7 sample documents. Two resume files were listed as skipped by name and nothing from them was sent.
- **The cache, proven:** after rebuilding every chunk, all rows said "not searchable yet". The backfill then sent **0 texts in 0 calls** and served 9 chunks from the cache.
- **Live path through your worker:** two files uploaded together. The text file went Indexing to Ready, the PDF went Processing, Indexing, Ready. Both were Ready about 9 seconds after upload, with 7 new vectors (4 and 3).
- **Search:** a question in other words ("money I can claim for setting up my desk at home") ranked the equipment policy first (0.7084 against 0.6590). Six questions in total are in `02-embeddings.md`, with the main lesson: scores are relative, and a question with no answer scored higher than a correct one.
- **Deleting** both uploaded documents brought the vector count back from 16 to 9.
- **Timing:** a search takes about 1 second, almost all of it the call that embeds the question.

## Tests

- 203 API tests pass (42 new since Checkpoint B), typecheck and lint clean in both apps.
- New tests: the limiter under a fake clock (including 200 random requests never exceeding the budget), vector bytes, cosine and ranking, the Gemini client with the provider call replaced, and 22 tests of the embedding step with a fake provider and real Postgres and Redis: progress, the cache, one workspace never using another's, retry that continues where it stopped, giving up with a plain reason, four error codes that fail at once, deletion mid-way, a changed model or wording, deleting vectors with documents, search isolation, and both real workers end to end.
- Every test app uses a fake embedding provider, so no test sends text anywhere.
- 18 deliberate breaks, all caught. One of them first slipped through: my test of "search only finds Ready documents" used a document with no vectors, so the filter was never needed. The test now uses a document that is part way through Indexing (vectors present, not Ready yet).

## Costs and surprises found

- **Ready changed meaning.** It now means "searchable". Documents made before this milestone are Ready with no vectors until the backfill runs, and the row says "not searchable yet" instead of pretending.
- **A Windows quirk:** `bun run search "words with spaces"` breaks, because bun re-parses the command through a shell and your user folder has a space. `bun run --cwd apps/api search` with no words asks for the workspace and the questions instead, and the direct form works too.
- **The embed call does not report tokens,** so the usage log shows `in=?` for embeddings.
- **The cache is per workspace,** so the same text in two workspaces is embedded twice. That trades some quota for isolation.
- **Ready documents you already had** were chunked by a rebuild, and the backfill only embeds fictional sample documents by default. Your two resume files are Ready but not searchable, and that is what their rows will say.

## Known gaps, on purpose

- The limiter lives in one process. Two workers would each assume the whole budget (Milestone 13).
- The sweeper can queue a slow, still-running embedding a second time. The second job finds nothing left to do and finishes at once.
- Search compares against every vector of the workspace. Fine for thousands of chunks, replaced by Qdrant in Milestone 6.
- There is no search box in the app yet (Milestone 7). Search is a script.
- Only the configured chunking strategy is embedded. The paragraph and fixed strategies are compared in Milestone 6.
- No per-document "do not send to AI" switch. The upload screen says "public documents only". A real privacy control belongs to Milestone 12 or 13.
- Retry after an embedding failure reads the document again from the start, which is cheap because of the cache.

## What you should be able to explain now

1. What a token is, and why limits and cost are in tokens.
2. What an embedding is, and why changing the model means embedding everything again.
3. What cosine similarity measures, and why unrelated text still scores about 0.6.
4. Why chunk size and overlap change retrieval quality, and how Milestone 6 will measure it.
5. Why the cache key holds the text fingerprint, the model, the dimensions and the wording.
6. Why the limiter counts tokens, and why it guesses 3 characters per token while chunks assume 4.

## Your part

- Quiz (6 questions) and exercises (3, including a small code change): `docs/learning/QUIZ.md`, section "Milestone 5". Nothing waits on them.
- Optional exercises: ask your own questions with `bun run --cwd apps/api search`, and watch the cache with a smaller chunk size and back (exercise B).
