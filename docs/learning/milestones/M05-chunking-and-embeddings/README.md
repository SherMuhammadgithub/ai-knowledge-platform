# Milestone 5: chunking and embeddings

**Status:** in progress, started 2026-09-20. Checkpoints A and B done. Waiting for your answers in `checkpoint-b-results.md` before Checkpoint C.
**Time budget:** about 12 hours (from `docs/PLAN.md`).

## Goal

Turn the page text stored in Milestone 4 into chunks, and give every chunk an embedding (a vector of 768 numbers that represents its meaning), so that a question can later be matched to the chunks that are closest in meaning.

```
document_pages (text per page)          <- built in Milestone 4
      |
   chunker          cut each page into pieces of about 400 to 500 tokens, with overlap
      |
document_chunks (text, page, position, hash)
      |
   embedder         Gemini embedding model, token-aware rate limit, cache by content hash
      |
chunk vectors (768 numbers each), stored in Postgres for now
      |
   plain search     embed a question, rank chunks by cosine similarity   (proof that it works)
```

Qdrant, filtering, top-K tuning and the chunking experiment come in Milestone 6.

## Results so far

- [`checkpoint-b-results.md`](checkpoint-b-results.md): what was built, the two chunkers compared on the same text, what you can see in the app, costs found, tests, and four questions for you.
- [`checkpoint-a-results.md`](checkpoint-a-results.md): the measured scores and token counts, what they mean, and three decisions for you.

## Read first

1. [`concepts.md`](concepts.md): the six concepts, taught before any code (tokens, embeddings and dimensions, cosine similarity, semantic vs keyword search, chunking, caching and limits).
2. Your pre-coding exercise: `docs/learning/QUIZ.md`, section "Milestone 5, before coding".

## Plan

Three checkpoints. I stop at each one, show you the result, and wait. You decide whether to go on.

**Checkpoint A: see embeddings with your own eyes**
- [x] A1. Read the current Gemini embedding docs: input limit 8,192 tokens, no task type (text prefix instead), dimensions 128 to 3072. Recorded in `docs/PLAN.md`.
- [x] A2. `bun run lab:embeddings` (`apps/api/src/scripts/embedding-lab.ts`): embeds questions and sentences, prints cosine scores. Your exercise pair A scored 0.7928, pair B 0.6725, unrelated 0.5900.
- [x] A3. Token estimate check: prose is over-estimated by up to 19%, codes and numbers under-estimated by 72%. Details in `checkpoint-a-results.md`.

**Checkpoint B: chunks exist and can be inspected**
- [x] B1. Migration: `document_chunks` (tenant table: workspace, document, page, chunk index, start and end position, text, token estimate, content hash, strategy name). Registered in `TENANT_MODELS` with a cross-tenant test.
- [x] B2. Chunker, two strategies behind one name field: `fixed` (naive, cut by size) and `paragraph` (production style: paragraphs, then sentences, size in tokens, overlap). Each rule has a test.
- [x] B3. Chunking runs in the worker after extraction. Deleting or re-running a document replaces its chunks (safe to run twice, like M4).
- [x] B4. Screen: the document shows its chunk count, and the text panel marks where chunks begin.

**Checkpoint C: embeddings and a working search**
- [ ] C1. Embedding cache table: vector, keyed by hash of (text, model, dimensions).
- [ ] C2. Token-per-minute limiter (the 30K tokens per minute limit is the one that binds), retries with backoff, usage records.
- [ ] C3. Embedding runs as its own job after chunking, because it can take minutes for a big document.
- [ ] C4. Status flow becomes Uploaded, Processing, Indexing, Ready or Failed. Ready now means "searchable". Update the seed data, the screen and the tests.
- [ ] C5. Plain search in code: embed a question, rank chunks by cosine similarity, in memory. A script that prints the top 5 with scores.
- [ ] C6. Docs: update `PROGRESS.md`, `DEMO_GUIDE.md`, this folder, the learning notes, and add the milestone quiz.

## Decisions from Checkpoint A (agreed 2026-09-20)

- Chunk sizing uses `characters / 4`. The rate limiter uses a stricter `characters / 3`, and the retry with backoff stays as the real safety net.
- The query and document prefix wording stays as it is. It is tested as an experiment in Milestone 6. The embedding cache key must include the prefix wording (or the final text), so old vectors are never reused after a change.
- Checkpoint B goes ahead.
- Before Checkpoint C sends stored text to Gemini: the user decides what to do about personal documents (resume files) in their workspace. Ask before running that step.

## Decisions (agreed before we started)

| Decision | Choice | Why | Cost |
|---|---|---|---|
| Chunk across page breaks? | No, chunk inside each page | Every chunk has one exact page for citations | A sentence that crosses a page break is cut. Listed as a known gap |
| Where do vectors live now? | Postgres | Keeps the pipeline visible. Postgres stays the source of truth | Not fast at large scale. Qdrant takes over in M6 and can be rebuilt from Postgres |
| Chunk size | About 400 to 500 tokens, 10 to 15 percent overlap, as a starting guess | Common starting point | Not proven. M6 measures it |
| Token counting | Estimate (characters / 4), checked once against real counts | Exact counts need a provider call | Estimates can be off by 10 to 20 percent |
| Status flow | Add an Indexing step | Extraction can succeed while embedding is still running or fails | "Ready" changes meaning. Seed, UI and tests change |

## What you should be able to explain at the end

1. What a token is, and why limits and cost are in tokens.
2. What an embedding is, what its dimension is, and why changing the model means re-embedding everything.
3. What cosine similarity measures, and why unrelated text still gets a middling score.
4. Why chunk size and overlap change retrieval quality, and how M6 will prove it with numbers.
5. Why we cache embeddings by content hash, and what the cache key must include.
6. Why the embedding limiter counts tokens and not only requests.

## Files this milestone is expected to touch

`apps/api/src/chunking/`, `apps/api/src/embedding/`, `apps/api/prisma/schema.prisma` (new migrations), `apps/api/src/worker/`, `apps/api/src/queue/`, `apps/api/src/llm/gemini/`, `apps/web/src/components/documents-view.tsx` and `document-text-sheet.tsx`, `apps/api/test/`.

## After the milestone

- Quiz and exercises go into `docs/learning/QUIZ.md` under "Milestone 5", and a short copy of the pointer goes here.
- The topic notes `01-llm-fundamentals.md`, `02-embeddings.md` and `03-chunking.md` are created in this folder and linked from `docs/learning/README.md`.
