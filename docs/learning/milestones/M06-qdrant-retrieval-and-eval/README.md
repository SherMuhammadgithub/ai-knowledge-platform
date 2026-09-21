# Milestone 6: Qdrant retrieval and the mini evaluation

**Status:** in progress, started 2026-09-21. Checkpoints A, B and C done (baseline stored). Waiting for your go on Checkpoint D.
**Time budget:** about 12 hours (from `docs/PLAN.md`). About 1 to 1.5 hours of that is yours: choosing the corpus and curating the test questions.

## Goal

Move meaning search into Qdrant, and measure retrieval quality with real numbers, so that decisions about chunking are based on evidence. The main output is a small evaluation harness and a comparison of three chunking strategies.

```
Postgres (chunks, source of truth)
      |  vectors from the cache (no new embedding needed)
      v
Qdrant collection   one collection, cosine, 768 dims, payload: workspace_id, document_id, chunk_id, strategy, page
      |  search always filtered by workspace
      v
retrieval  ---------------------->  evaluation harness
   top-K chunks                       question file -> run -> hit rate@k, MRR -> stored run
```

## Results so far

- [`checkpoint-c-results.md`](checkpoint-c-results.md): the baseline, what it does and does not show, the two rank-2 questions, score ranges for unanswerable questions, and what it means for Checkpoint D.
- [`checkpoint-c-review-guide.md`](checkpoint-c-review-guide.md): your part of Checkpoint C. What to do with the 32 drafted questions, the rule that matters most, how a hit is judged, and the questions themselves.
- [`checkpoint-b-results.md`](checkpoint-b-results.md): Qdrant built and checked, the design in practice, real results, tests, costs, gaps.
- [`checkpoint-a-results.md`](checkpoint-a-results.md): Qdrant facts checked by experiment, corpus candidates with licences (two excluded), the foundation review, and three decisions for you.

## Read first

1. [`concepts.md`](concepts.md): six concepts taught before any code (vector databases, filtering, top-K, measuring retrieval, the chunking experiment, headings).
2. Your pre-coding exercise: `docs/learning/QUIZ.md`, section "Milestone 6, before coding".

## Plan

Five checkpoints. I stop at each one, show you the result, and wait.

**Checkpoint A: corpus, Qdrant facts, and a foundation review**
- [x] A1. Read Qdrant's current docs and checked every behaviour we depend on with a real experiment. Recorded in `docs/PLAN.md`.
- [x] A2. Choose the corpus (GOV.UK employment guidance, 7 documents, 36 chunks): 5 to 8 public documents in one domain. Record the source and licence of each in `eval/corpus/LICENSES.md`. **You choose the domain.** Documents are uploaded through the normal pipeline into a test workspace.
- [x] A3. Baseline look with the plain search on a few questions, and a written foundation review: what would we change now? Known candidates: headings are not kept, chunks never cross pages, no way to say "I don't know". You decide what goes into this milestone.

**Checkpoint B: Qdrant**
- [x] B1. Collection design: one collection, cosine distance, 768 dimensions, indexed payload fields `workspace_id` and `document_id`. Point id is the chunk id, so writing is repeatable.
- [x] B2. A small vector index module: write points when a document becomes Ready, delete them when it is deleted, search with a workspace filter that cannot be left out. A rebuild script fills Qdrant from Postgres and the cache (no new embedding calls).
- [x] B3. Tests: Qdrant's top results match the exact brute-force results, another workspace's chunk is never returned even when it is closer, delete removes the points, plus deliberate breaks as before.
- [x] B4. The `search` script uses Qdrant, with a flag to compare against the exact search.

**Checkpoint C: the evaluation harness**
- [x] C1. Question file format in `eval/questions/govuk.json`: question, status, expected quotes with their document, answerable yes or no. Checked by a schema.
- [x] C2. 32 candidate questions drafted from the public corpus (27 answerable, 5 not), each with a quote copied from the guide and tested. **At your request, Claude chose keep or drop** (22 kept: 18 answerable, 4 not; 10 dropped) judging only whether a real employee could ask it, before any search results existed. Not reviewed or reworded by a human, so wording stays close to the guides and scores may lean high.
- [x] C3. The harness (`apps/api/src/evaluation/`, `eval:check`, `eval:run`): batch-embeds the questions, searches through Qdrant with the product's own search code, computes hit rate@1/3/5 and MRR, and stores the run (chunk settings, embedding setup, documents searched, one result per question) in the tenant table `eval_runs` and as JSON in `eval/runs/`.
- [x] C4. Baseline on `paragraph` chunks, stored (`eval_runs` row and `eval/runs/2026-09-21T08-58-40-paragraph-baseline.json`): hit rate @1 88.9%, @3 100%, @5 100%, MRR 0.944 over 18 answerable questions chosen by the assistant. Close to the ceiling, so D may show no difference.

**Checkpoint D: the chunking experiment**
- [ ] D1. Heading detection and a heading-aware chunker, with tests. The approach comes from your decision at A3.
- [ ] D2. Embed the corpus under each strategy (a few thousand tokens per document, planned around the 30K tokens per minute limit).
- [ ] D3. Run all three strategies on the same questions. A results table with the numbers, an analysis of the failures, and a decision on the default strategy. If time allows, three chunk sizes for the winner.

**Checkpoint E: closing**
- [ ] E1. Topic notes `05-retrieval.md` and `07-evaluation.md` (started), quiz and exercises, `PROGRESS.md`, `DEMO_GUIDE.md`, this folder, the index.

## Decisions (change any of these before we start)

| Decision | Choice | Why | Cost |
|---|---|---|---|
| Collections | One collection with an indexed `workspace_id` payload | Already decided for the project. Standard multi-tenant pattern | A filter that is left out breaks isolation, so the search function makes it mandatory and a test fails without it |
| Point id | The chunk id | Writing the same chunk twice updates it instead of duplicating | Re-chunking creates new ids, so old points must be removed |
| When points are written | When a document becomes Ready | Ready already means "every chunk has a vector" | One more step in the pipeline and one more place to fail |
| Source of truth | Postgres, with the vector cache | Qdrant can be rebuilt without new embedding calls | Two copies of every vector |
| What counts as a correct result | The retrieved chunk contains the expected quote | Judges every chunking strategy fairly, because chunk ids change and quotes do not | Someone must write a quote for each question |
| Corpus | 5 to 8 public documents, one domain, licences recorded. My suggestion: open-source project documentation written as prose with clear headings | Public text may be sent to Gemini, headings let heading-aware chunking be tested, and licences are usually clear | Your choice, and I will check each licence before use |
| Questions | Language model proposes about 30, you keep about 20 | Fully machine-made sets are too easy, and this keeps your effort to about an hour | 20 is small: results are a signal, not proof |
| Stored runs | In the database and as JSON in `eval/runs/` | Numbers in docs may only come from stored runs | An evaluation table with a workspace column and its isolation test |
| Heading detection | Patterns first (numbered headings, short lines before a blank line), Word heading styles if the corpus has them | Cheapest, and testable | Can be wrong. A document without headings gets no benefit |

## What you should be able to explain at the end

1. Why a vector database, and what approximate nearest neighbour search trades away.
2. Why the workspace filter must apply during the search and not after it.
3. What hit rate@k and MRR measure, and why 20 questions give a signal and not proof.
4. Why the correct answer is defined by a quote and not by a chunk id.
5. What the chunking experiment showed with numbers, and what it could not show.
6. What would make us change the foundation, based on the failures.

## Files this milestone is expected to touch

`apps/api/src/vector/` (new), `apps/api/src/search/`, `apps/api/src/chunking/` (heading-aware chunker), `apps/api/src/processing/` (heading detection), `apps/api/prisma/schema.prisma` (evaluation tables), `apps/api/src/worker/`, `eval/` (corpus licences, questions, runs, harness), `apps/api/test/`, `docker-compose.yml` only if Qdrant needs a setting.

## Your part

- Choose the domain for the corpus (Checkpoint A).
- Read about 30 proposed questions, rewrite or drop the weak ones, and write the expected quote for the ones you keep (Checkpoint C). About an hour.
- Decide, after the foundation review, what goes into this milestone.

## After the milestone

Quiz and exercises go into `docs/learning/QUIZ.md` under "Milestone 6". Topic notes are created in this folder.
