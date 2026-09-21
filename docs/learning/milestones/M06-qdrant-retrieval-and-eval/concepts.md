# Milestone 6 concepts (taught before coding)

Written 2026-09-21. Each concept follows the same steps: what it is, why this project needs it, the naive approach, the production approach, the tradeoffs.

## 1. A vector database, and what Qdrant does

- **What it is:** a database built for one job: given a vector, find the stored vectors closest to it, fast. Qdrant stores **points**. A point is an id, a vector, and a small **payload** (a bit of JSON such as `workspace_id`, `document_id`, `chunk_id`, `page`). Points live in a **collection**, which is like a table.
- **Why we need it:** our plain search compares the question with every vector of the workspace. That is fine for a few thousand chunks and slow for millions, and it loads every vector into memory for each question.
- **Naive approach (what we built):** loop over all vectors, score each, keep the best. Exact, simple, visible.
- **Production approach:** an **approximate nearest neighbour** index (Qdrant uses HNSW). It builds a graph that links each vector to its neighbours. A search starts somewhere, hops to closer and closer neighbours, and stops. It looks at a tiny share of the vectors and finds the closest ones almost every time.
- **Tradeoffs:**
  - Approximate: very rarely it can miss a true neighbour. Tunable, and we can check it against our exact loop.
  - One more service to run.
  - Data in two places. Postgres stays the source of truth, and Qdrant is filled from it and can be rebuilt any time.

## 2. Filtering by metadata: tenant isolation again

- **What it is:** telling the search "only consider points where `workspace_id` is this one".
- **Why it matters:** this is how one Qdrant collection serves every workspace without mixing them. It is the same rule as the rest of the project: the workspace comes from the session on the server, never from the client, and every search applies it.
- **Naive approach:** search everything, then throw away results from other workspaces. This is wrong twice. Other workspaces' data was read, and if the five closest points belong to another workspace you are left with nothing.
- **Production approach:** filter **during** the search, with an indexed payload field (`workspace_id`), so Qdrant only walks points that pass the filter. Fast, and it always returns the best matches within the workspace.
- **Tradeoffs:** payload indexes cost some memory. A search function that lets a caller skip the filter would break isolation, so the filter must be impossible to leave out, and a test must fail if it is.

## 3. Top-K and score thresholds

- **Top-K:** how many chunks a search returns. A larger K is more likely to include the right chunk, and adds noise and, later, more tokens in the answer prompt.
- **Score threshold:** dropping results below some score. We already saw why this is fragile: scores are relative, and a question with no answer scored higher than a correct one.
- **What we do:** choose K by measuring (concept 4), and treat thresholds as something to test, not assume.

## 4. Measuring retrieval: hit rate and MRR

- **What it is:** a small test set of questions where you know which text answers each. For every question, run the search and see where the correct text ranks.
- **Why we need it:** your marks question showed that a search can look fine and fail on a simple question. Without numbers, every change (chunk size, wording, K) is a guess.
- **The two numbers:**
  - **Hit rate@k:** the share of questions whose right chunk is in the top k. 14 of 20 in the top 3 is 0.70.
  - **MRR** (mean reciprocal rank): for each question take 1 divided by the rank of the right chunk (rank 1 gives 1, rank 2 gives 0.5, rank 3 gives 0.33, not found gives 0), then average. It rewards ranking the right chunk higher, not just including it.
- **Naive approach:** try a few questions by hand and judge by feel.
- **Production approach:** a fixed question file, a script that runs it, and stored runs, so any change can be compared with the last run using the same questions.
- **How we say which chunk is "right":** by the exact quote that answers the question, not by a chunk id. A chunk counts as a hit if it contains the quote. Chunk ids change every time the chunking rules change, and quotes do not, so the same questions can judge every chunking strategy fairly.
- **Tradeoffs and traps:**
  - 20 questions is small. One question is 5 percentage points. Results are a signal, not proof.
  - Questions that copy the document's words are too easy. Good questions use other words, like "vacation" for "annual leave".
  - Questions written by a language model are biased to look like the text. A human has to read, fix and choose them.
  - Unanswerable questions belong in a separate test (Milestone 10).

## 5. The chunking experiment

- **What it is:** the same corpus, the same questions and the same embedding setup, with only the way text is cut changed, and the numbers compared.
- **Strategies:** `fixed` (naive), `paragraph` (what we use now), and `heading-aware` (new in this milestone).
- **How to keep it fair:**
  - Change one thing at a time.
  - A different chunk size means different numbers of chunks, so K=5 covers different amounts of text. Report tokens retrieved too.
  - Look at the failures one by one. A wrong result usually teaches more than an average.
- **Cost:** every strategy makes different chunks, so each needs its own embeddings. On the free tier that is minutes per strategy, and the cache only helps where text is identical.

## 6. Heading-aware chunking and what it needs

- **What it is:** cutting at section headings and keeping the heading with its text, so a paragraph knows which section it belongs to. "4.2 Annual leave" travels with the leave paragraph instead of being left behind at the end of the previous chunk.
- **Why it might help:** chunks that mix topics get blurred vectors, and chunks that lose their heading lose context. It is also what citations like "Section 4.2" need.
- **What it needs:** headings. Reading a file currently keeps only plain text. Options, from cheapest: guess from patterns (numbered lines like "4.2 Annual leave", short lines followed by a blank line), use Word heading styles when the file has them, or use font sizes in PDFs (hard).
- **Tradeoffs:** pattern guessing can be wrong, and a strategy that depends on headings does nothing for a document without any. We test on real documents before deciding.

## Short glossary

| Term | Meaning |
|---|---|
| Point | One entry in Qdrant: id, vector, payload |
| Collection | A set of points, like a table |
| Payload | Small metadata stored with a point, such as `workspace_id` |
| HNSW | The graph index Qdrant uses for fast approximate search |
| Approximate nearest neighbour | Finds almost the closest vectors without checking them all |
| Top-K | The K best results of a search |
| Hit rate@k | Share of questions whose right answer is in the top k |
| MRR | Average of 1 / rank of the right answer |
| Corpus | The set of documents used for testing |
| Ground truth | The known right answer for a test question |
