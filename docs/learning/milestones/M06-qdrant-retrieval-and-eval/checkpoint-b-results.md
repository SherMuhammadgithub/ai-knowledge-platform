# Checkpoint B results (2026-09-21)

Meaning search now goes through Qdrant. Postgres stays the source of truth.

## What was built

```
document becomes Indexing -> embeddings (Postgres cache, from Milestone 5)
                          -> "Adding to the search index": one point per chunk written to Qdrant
                          -> Ready   (Ready now means: vectors made AND in Qdrant)

question -> vector -> Qdrant: closest points where workspace = yours, same setup, same strategy
         -> chunk text and document name read from Postgres -> results
```

| Piece | Where |
|---|---|
| Qdrant client (official, pinned to 1.19.0) | `apps/api/package.json` |
| Collection setup and checks, write, delete, search, counts | `apps/api/src/vector/vector-index.service.ts` |
| Search through the index (same result shape as the plain loop) | `apps/api/src/search/qdrant-search.ts` |
| The plain exact loop, kept as the checker | `apps/api/src/search/plain-search.ts` |
| Indexing step: points written before Ready | `apps/api/src/embedding/document-indexer.service.ts` |
| Deleting a document deletes its points | `apps/api/src/documents/documents.service.ts` |
| Consistency helpers | `apps/api/src/vector/consistency.ts` |
| `bun run --cwd apps/api qdrant:sync` (add `--check` to only compare) | `apps/api/src/scripts/qdrant-sync.ts` |
| `search` script uses Qdrant, `--exact` uses the loop, `--compare` runs both | `apps/api/src/scripts/search.ts` |
| Setting | `QDRANT_COLLECTION` (default `akp_chunks`) |

## The design in practice

- **One collection, cosine, 768 dimensions**, with payload indexes on `workspace_id` (the tenant index), `document_id`, `strategy` and `setup_id`.
- **The point id is the chunk id.** Writing a chunk again updates it.
- **The payload has ids and positions only, no chunk text.** A test checks the stored payload exactly and that no text is in it.
- **The filter cannot be left out.** `search` takes the workspace from the scoped client (`db.workspaceId`), so there is no parameter that could name another workspace. It also filters on the embedding setup and the chunking strategy, so vectors of different setups or strategies never mix.
- **Write first, delete second.** Bringing a document up to date writes its points, then removes its points whose chunk no longer exists. A search in between never sees a document with no points.
- **Ready means in Qdrant.** If Qdrant is down at that step, the document stays Indexing, the queue retries, and vectors already made are kept.
- **The API starts even if Qdrant is down.** Uploads still work, and indexing retries.
- **Errors from Qdrant are wrapped** so they carry no HTTP status. Otherwise a status like 400 could be mistaken for "the AI service refused the text".

## Real results

- **`qdrant:sync --check`** (changes nothing) on your data: every workspace differed, all points missing (4, 36, 5 and 3).
- **`qdrant:sync`** wrote **48 points** from the vectors already in Postgres. It made no calls to Gemini. The second check said "Qdrant matches Postgres".
- **The six baseline questions** through Qdrant with `--compare`: the same chunks, in the same order, with the same scores as the plain loop, and as the baseline from Checkpoint A.
- **Qdrant's own view:** the collection has 48 points and status green, with **0 indexed vectors**. That means Qdrant has not built its approximate index, because the collection is small, and searches everything exactly. Dashboard: `http://localhost:6333/dashboard`.

**What this comparison proves, and what it does not.** It proves that our ids, payload, filters and text lookup are wired correctly, because the exact loop and Qdrant agree. It does **not** say anything about how good Qdrant's approximate index is, because at this size the index is not used. That would need far more points than we have.

## Tests

- 221 API tests pass (203 before, 18 new in `vector.e2e.spec.ts`, against the real Qdrant with a collection of each test app's own, dropped afterwards).
- They cover: the collection shape and the tenant index, refusing a collection with the wrong size, starting with Qdrant down, one point per chunk with the exact payload, running again without doubling, points replaced after a re-cut, parity with the exact search (scores at every rank, and the same chunk wherever the score is not tied), another workspace's closer chunk never returned (the test first proves an unfiltered search would return it), the setup filter, the strategy filter, Ready-only results, deleting points with a document (and only that document's), a delete when Qdrant is unreachable, Ready only after the points exist, retries and a plain failure reason, and the consistency helpers.
- **13 deliberate breaks, all caught:** no workspace filter, no setup filter, no strategy filter, stale points kept, other strategy's points deleted, points left after delete, Ready without points, text stored in Qdrant, wrong vector size accepted, tenant index off, errors not wrapped, non-Ready documents returned, and the vector table unscoped in Postgres.

## Costs and surprises

- **Tied scores in the fake vectors.** My fake embedding vectors give exactly equal scores to unrelated chunks, and Qdrant and the loop order exact ties differently. The parity test now compares the scores at every rank and the chunk ids wherever the score is not tied. Real Gemini vectors almost never tie exactly.
- **Two stores, one truth.** Postgres and Qdrant cannot be updated in one transaction. The design keeps Postgres authoritative, writes Qdrant last, and provides `qdrant:sync --check` to find any difference (for example points left behind if Qdrant was down during a delete).
- **Documents that were Ready before this checkpoint** were not in Qdrant. `qdrant:sync` fixed the existing ones.
- **A worker that was not restarted after this change** would make documents Ready without adding them to Qdrant, because the worker is not a watch process. Yours was restarted and the live check passed. `qdrant:sync` repairs any document that was missed, and the row does not say so yet.
- **Search takes about 1 second,** almost all of it the call that embeds the question, not Qdrant.

## Known gaps, on purpose

- No test of Qdrant's approximate index, because the corpus is too small to use it.
- The stop-and-start of the Qdrant container during indexing was tested with a simulated failure, not by stopping the container.
- Qdrant's data lives in its Docker volume. If the volume is lost, `qdrant:sync` rebuilds it from Postgres without calling Gemini.

## The live path, confirmed (after you restarted the worker)

Two fictional demo files uploaded as Alice through your running API and worker, with real Gemini calls:

- The text file went Uploaded, Indexing, **Indexing ("Adding to the search index")**, Ready in 3.7 seconds. The PDF went Uploaded, Processing, Indexing, "Adding to the search index", Ready in 4.6 seconds.
- `qdrant:sync --check` (which repairs nothing, so a missed write would show) said Acme Corp was in step: 11 chunks with vectors, 11 points (4 before, 7 more for the two files).
- A question in other words ("money I can claim for setting up my desk at home") through Qdrant with `--compare` returned the same chunks in the same order as the exact loop, the equipment policy first (0.7084, then 0.6590 and 0.6153).
- Deleting both documents brought the count back to 4 points, still in step: their points were removed with them.

## Questions for you

1. **Go for Checkpoint C** (the evaluation harness)? It needs about an hour of your time, once I have a draft of the questions for you to read and fix.
