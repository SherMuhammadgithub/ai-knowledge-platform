# Retrieval: finding the right chunks (Milestone 6)

## Concept

Retrieval is the step that takes a question and returns the few chunks most likely to answer it. In this project it has three parts:

1. **Embed the question** into a vector, with the same model and wording that embedded the chunks.
2. **Ask a vector database (Qdrant) for the closest points**, restricted to this workspace, this embedding setup and this chunking strategy.
3. **Read the chunk text from Postgres** for the points that came back, and return them in order of score.

Nothing here writes an answer. It only decides what a later step will be allowed to read.

## Why it matters

- The answer prompt has limited room, and a language model can only use what it is given. If retrieval misses the right chunk, no prompt can fix it.
- Every chunk of every workspace sits in one index. Search has to stay inside one workspace, always.
- Retrieval quality can be measured on its own (see `07-evaluation.md`), before any answer is written. That is why Milestone 6 comes before Milestone 7.

## Mental model

```
question --embed--> vector
                      |
                      v
   Qdrant: closest points where workspace = mine AND setup = current AND strategy = chosen
                      |  (ids and scores only, no text)
                      v
   Postgres: chunk text and document name for those ids, Ready documents only
                      |
                      v
   top 5 chunks, best first
```

Two stores, two jobs:

| | Postgres | Qdrant |
|---|---|---|
| Holds | Chunk text, pages, documents, the vector cache | One point per chunk: vector plus ids and positions |
| Is | The source of truth | A search index that can always be rebuilt |
| Answers | "What does this chunk say?" | "Which chunks are closest to this vector?" |

## The parts, and why each is there

**A vector database instead of a loop.** The plain search of Milestone 5 compared the question with every vector of the workspace. That is exact and fine at 36 chunks, and it slows down as the number of chunks grows. Qdrant builds an index (HNSW, a graph of nearby points) so it can find close points without visiting all of them. That is **approximate nearest neighbour** search: it trades a small chance of missing a true neighbour for a large gain in speed. Below a size limit (`full_scan_threshold`, 10,000 kilobytes of vector data: about 3,300 vectors of our 768 numbers, since Qdrant counts 1 KB as one vector of 256 numbers) Qdrant does not bother and scans everything exactly. Our whole collection has 119 points (107 of them the GOV.UK guides), and Qdrant reports 0 indexed vectors (checked 2026-09-21), so **every search so far was exact**. That means our tests prove the wiring (ids, filters, text lookup) and say nothing about how good Qdrant's approximate index would be at scale.

**The workspace filter applies during the search, not after it.** If you ask for the top 5 and then remove other workspaces' results, workspace A can get nothing back when workspace B has 50 closer chunks, and B's data was touched for A's request. Qdrant filters while it searches, so the top 5 come from A's own chunks. The filter cannot be left out: `VectorIndexService.search()` takes the workspace from the scoped client (`db.workspaceId`), and there is no parameter that could name another one. A test first proves that an unfiltered search would return another workspace's closer chunk, then that the real one never does.

**Setup and strategy filters.** Vectors made with different models, sizes or wording cannot be compared, and a chunk from another chunking strategy is a different piece of text. Every search filters on both, so they never mix. This is what let three strategies live side by side in one collection in Milestone 6.

**One point per chunk, id = chunk id, ids and positions only.** Writing the same chunk twice updates it, so repeating a write is safe. No chunk text is stored in Qdrant, which keeps it a disposable index and keeps private text in one place. A test checks the exact payload and that no text is in it.

**Ready means in the index.** A document becomes Ready only when its vectors exist and its points are in Qdrant. If Qdrant is down at that step, the document stays Indexing and the queue retries. The API still starts with Qdrant down.

**Two stores cannot share a transaction.** Postgres is authoritative and Qdrant is written last. When a document is re-cut, the new points are written first and the stale ones removed second, so a search in between never sees a document with no points. When a document is deleted, its row goes first; if Qdrant is unreachable, the leftover points are harmless (search skips any point whose chunk is gone) and `qdrant:sync` removes them.

**Scores are relative.** Cosine similarity says how close two directions are, not whether the text answers the question. With `gemini-embedding-2`, unrelated text scores around 0.6. On our questions the closest chunk scored 0.665 to 0.798 when the guides could answer, and 0.627 to 0.717 when they could not (baseline run). Those ranges overlap, so a fixed cutoff cannot decide "answered or not". The gap between the first and second result says more than the top score.

## What we implemented, and where

| Piece | File |
|---|---|
| Collection setup, write, delete, search, counts | `apps/api/src/vector/vector-index.service.ts` |
| Consistency helpers | `apps/api/src/vector/consistency.ts` |
| Search through the index (embed, Qdrant, Postgres) | `apps/api/src/search/qdrant-search.ts` |
| The plain exact loop, kept as a checker | `apps/api/src/search/plain-search.ts` |
| Points written as the last indexing step, then Ready | `apps/api/src/embedding/document-indexer.service.ts` |
| Points removed with a document | `apps/api/src/documents/documents.service.ts` |
| Make Qdrant match Postgres (no Gemini calls) | `bun run --cwd apps/api qdrant:sync` (add `--check` to only compare) |
| Ask questions in a terminal, through Qdrant, the loop, or both | `bun run --cwd apps/api search` (`--exact`, `--compare`) |
| Tests, with the real Qdrant and a collection per test app | `apps/api/test/vector.e2e.spec.ts` |

## What the measurements showed

From the stored runs of Milestone 6 (details in `checkpoint-c-results.md` and `checkpoint-d-results.md`, 22 questions chosen by the assistant):

- Search found the right guide first for all 18 answerable questions, and the right chunk first for 16 of them (hit rate @1 88.9%, MRR 0.944).
- Cutting chunks in the middle of sentences (`fixed`) dropped hit rate @1 to 66.7%. Cutting at headings (`heading`) gave 83.3%, one question below `paragraph`, which is within noise.
- Hit rate @3 and @5 were 100% for all three strategies. With 36 chunks in seven guides, that says almost nothing.
- When a wrong chunk won, it was often the guide's first chunk (the title and overview): 6 of 11 cases across the three runs. That fits a worry from the foundation review, but 11 cases is too few to be sure.

## Tradeoffs

- **Exact versus approximate search.** Approximate is faster at scale and can miss a true neighbour. Exact is always right and slows down with size. At our size Qdrant chooses exact by itself.
- **One collection for every workspace** (a filter isolates them) versus one collection per workspace. One collection is the standard multi-tenant pattern and keeps the number of collections small. Its cost is that isolation depends on a filter that must never be forgotten, so the function makes it mandatory and a test fails without it.
- **Vectors in two places** (Postgres cache and Qdrant). It makes Qdrant rebuildable without new embedding calls, at the cost of storing every vector twice and keeping the two in step.
- **Top-K.** A larger K raises the chance that the right chunk is included, and fills the answer prompt with more text that may not be needed.

## Common mistakes

- Filtering by workspace after the search instead of during it.
- Storing chunk text in the vector database as well, so there are two copies to keep in step and private text in a second place.
- Treating a cosine score as a probability, or choosing a cutoff without measuring.
- Believing a test that compares Qdrant with the exact loop says the approximate index is good. At small sizes both are exact.
- Forgetting that a re-cut creates new chunk ids, so old points must be removed.
- Comparing vectors from different embedding setups.

## Interview questions

1. Why does a workspace filter have to apply during a vector search and not after it? Give a case where the difference changes the result.
2. What does approximate nearest neighbour search give up, and when is it not worth using?
3. Postgres and Qdrant cannot be changed in one transaction. Which one do you write first, and what do you do about the difference?
4. Your search returns a top score of 0.71. What can you conclude about the answer, and what can you not?
5. How would you find out whether Qdrant's approximate index is good enough for your data?

## Try it

1. `bun run --cwd apps/api qdrant:sync --check`. Every workspace should say "in step". For the GOV.UK workspace the points (107) are more than its chunks with a vector for the default strategy (36), because three strategies live there. Why is it still "in step"?
2. Open `http://localhost:6333/dashboard` and the collection `akp_chunks`. Look at one point's payload. What is in it, and what is missing on purpose?
3. `bun run --cwd apps/api search` for the workspace "Acme Corp", with `--compare`. Ask a question in other words than the document uses.
4. Look at `VectorIndexService.search()`. Find the line that puts the workspace in the filter, and check where its value comes from. Could a caller change it?
