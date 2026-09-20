# Embeddings: turning text into vectors you can compare (Milestone 5)

## Concept

An **embedding** is a list of numbers that stands for the meaning of a text. Ours, from `gemini-embedding-2`, has 768 numbers. Two texts with similar meaning get lists that point in similar directions, even when they share no words. **Cosine similarity** measures how closely two lists point the same way: near 1 is very close, lower is less related.

A question is turned into a vector the same way, and the stored chunk vectors are ranked by how close they are to it. That is meaning search.

## Why it matters

- It finds "annual leave" when someone asks about "vacation days". Keyword search cannot.
- It is the first step of retrieval-augmented answers: find the passages, then let a model answer from them.
- It is also where cost and limits show up: every chunk is a call to a provider with a per-minute token budget.

## Mental model

```
chunk text ---------------------> embedding model ---> 768 numbers (a vector)
question   ---(query wording)---> embedding model ---> 768 numbers

score = cosine(question vector, chunk vector)      rank the chunks, keep the top few
```

Our pipeline, with the document status at each step:

```
upload            Uploaded
reading worker    Processing   read the file, clean it, cut chunks       (queue "document-processing")
embedding worker  Indexing     vectors for the chunks, "Embedding 16 of 25 chunks"   (queue "document-embedding")
                  Ready        every chunk has a vector: searchable
```

Facts about the model, read from the docs and checked by running (Checkpoint A):

- Up to 8,192 tokens per text. Dimensions 128 to 3072, we use 768.
- The vectors come normalised (length 1.0000), so cosine similarity equals the plain dot product.
- No task type parameter. Whether a text is a question or a passage is written into the text with a short instruction. Our client adds it.

## What real scores look like

Measured with the real model, on fictional sample documents. Each of these documents is one chunk, except the equipment policy (four chunks).

| Question | Right document first? | Top score | Rank 2 | Gap |
|---|---|---|---|---|
| "How many vacation days do I get?" (document says "annual leave") | Yes | 0.6947 | 0.6471 | 0.048 |
| "Can I work from home on Fridays?" | Yes | 0.7256 | 0.6567 | 0.069 |
| "Daily limit for meals on business trips?" | Yes | 0.7359 | 0.6377 | 0.098 |
| "How do I claim health insurance?" | Yes | 0.6432 | 0.6258 | 0.017 |
| "Policy on pets in the office?" (nothing about pets anywhere) | No such document | 0.6805 | 0.6566 | 0.024 |
| "How much money can I claim for setting up my desk at home?" (equipment policy uploaded later) | Yes | 0.7084 | 0.6590 | 0.049 |

What this shows, and what it does not:

1. **Scores are relative.** The question with no answer scored 0.68, higher than the correct answer to the health insurance question at 0.64. A fixed cutoff such as "above 0.6" would answer the pets question and reject the insurance one.
2. **Unrelated text still scores about 0.6.** A useful result stands out by a gap of a few hundredths, and gaps of 0.017 are easy to misread.
3. **The meaning match works.** "Vacation" found "annual leave", and "setting up my desk at home" found a "home office allowance" section, with no shared key words.
4. **Nothing here says "I don't know".** The search always returns its best guesses. Deciding when to refuse is a later problem (answer prompts in Milestone 7, evaluation in Milestone 10).
5. Six examples are an illustration, not a measurement. Milestone 6 measures hit rate and reciprocal rank on real questions.

## The cache, and the setup id

Each vector is stored once, in `chunk_embeddings`, keyed by:

1. the workspace,
2. the fingerprint (SHA-256) of the chunk text,
3. the **setup id**: `<model>|<dimensions>|<wording fingerprint>`, for example `gemini-embedding-2|768|d290113f`.

The wording fingerprint is computed from the actual instruction text the client puts in front of each text, so editing the wording changes the setup id by itself. Vectors from different setups cannot be compared, so the setup must be part of the key. If it were not, a model change would silently mix incompatible vectors and scores would become meaningless with no error.

Consequences we tested, with real runs:

- Upload the same text again (or re-chunk with the same settings): no provider call. After a full chunk rebuild, the backfill sent **0 texts** to Gemini and served all 9 chunks from the cache.
- Change the model, size or wording: every chunk counts as "not embedded" again, and the vectors are made again. The old ones stay under their own setup id.
- The cache is per workspace on purpose. The same text in two workspaces is embedded twice, which costs some quota and keeps one workspace from learning what another has stored.
- When a document is deleted, its vectors are deleted, except one that another document in the workspace still uses.

## What we implemented, and where

| Piece | File |
|---|---|
| Embedding client, token-aware batching, setup id | `apps/api/src/llm/gemini/gemini-embedding-client.ts` |
| Token-per-minute limiter | `apps/api/src/llm/resilience.ts` (`TokenLimiter`) |
| Embed one document's chunks, using the cache, saving after each group | `apps/api/src/embedding/chunk-embedder.ts` |
| The worker step: Indexing to Ready, progress, retries, permanent errors | `apps/api/src/embedding/document-indexer.service.ts` |
| Vector bytes (32-bit floats) | `apps/api/src/embedding/vector.ts` |
| Cosine and ranking | `apps/api/src/search/similarity.ts` |
| Plain search over a workspace | `apps/api/src/search/plain-search.ts` |
| Tables `chunk_embeddings`, and `embedded_with` on `document_chunks` | `apps/api/prisma/schema.prisma` |
| The embedding queue and worker | `apps/api/src/queue/`, `apps/api/src/worker/document.worker.ts` |
| Scripts | `bun run --cwd apps/api embed:backfill`, `bun run --cwd apps/api search` |
| Tests | `apps/api/test/embedding.spec.ts`, `indexing.e2e.spec.ts` (with a fake provider, so no test calls a real one) |

## Tradeoffs

- **Vectors in Postgres:** simple and visible, and the search compares against every vector of the workspace. Fine for thousands of chunks. Qdrant replaces it in Milestone 6.
- **768 dimensions:** a recommended size. Larger is more precise and costs more storage and comparison time.
- **Meaning search alone:** it can miss exact things such as names, codes and numbers. Hybrid search (Milestone 11) adds keyword search.
- **Saving after each group of 16:** more database writes, but a crash or a rate-limit failure loses at most one group, and the screen can show real progress.
- **A separate embedding queue with one job at a time:** slower on paper, but it matches a limiter that lives in one process and stops a long embedding from blocking reading.

## Common mistakes

- Comparing vectors made by different models or different wording.
- Treating a score as a probability or using one cutoff for all questions.
- Embedding questions and passages the same way when the model expects different instructions.
- Re-embedding unchanged text on every run.
- Forgetting to delete derived vectors when the source document is deleted.
- Testing the embedding pipeline against the real provider, which is slow, limited and sends text out.

## Interview questions

1. What does an embedding capture, and what does it not capture?
2. Why must every vector in an index come from the same model and setup?
3. Why is cosine similarity enough here, and what does it mean that our vectors have length 1?
4. How would you decide when to answer "I don't know" if scores are only relative?
5. What goes into your cache key, and what breaks if you leave part of it out?
6. How do you make embedding a large document safe against crashes and rate limits?

## Try it

1. Run `bun run --cwd apps/api search` and ask a question in your own words, then one that the documents do not answer. Compare the top scores and the gaps.
2. Upload `demo-files/equipment-policy.txt`, watch it go Indexing then Ready, and search for "money to set up my desk at home".
3. Delete that document and check `SELECT count(*) FROM chunk_embeddings;` before and after.
