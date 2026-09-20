# AI Knowledge Platform — Initial Plan

Status: approved by the user on 2026-09-19, including the M6 mini-eval reorder. Nothing implemented yet.

## 1. Why this project

A RAG chatbot alone is a tutorial. What makes this worth showing to clients:
- measured retrieval and answer quality (evaluation pipeline with real numbers)
- tenant isolation that is tested
- prompt-injection attacks demonstrated and defended

The user already knows Next.js, NestJS, Prisma, BullMQ, Docker, so those milestones stay thin. Most learning time goes to embeddings, chunking, retrieval quality, evals and security.

## 2. Architecture

```
Next.js (web)  -- REST + SSE (streaming answers) -->  NestJS API (modular monolith)
                                                       |- auth / workspaces
                                                       |- documents (upload, status)
                                                       |- retrieval, reranking, llm, conversations
                                                       '- evaluation
                                                              |
        +---------------------+-------------------+-----------+-----------+
   PostgreSQL              Qdrant               Redis               File storage
   (source of truth)    (vectors, disposable)   (BullMQ queues)     (local volume behind
                                                     |               a StorageService)
                                              Worker process (same codebase,
                                              separate entrypoint):
                                              extract -> clean -> chunk -> embed -> upsert
                                                     |
                                              LLM / embedding provider (Gemini free tier)
```

### Decisions

| Decision | Choice | Reason |
|---|---|---|
| Language | TypeScript only | `pdfjs-dist` and `mammoth` cover PDF/DOCX. Python only needed for OCR and local ML, both out of scope |
| Repo | Bun workspace: `apps/web`, `apps/api`, `eval/`, `docs/`. Bun is the package manager and script runner. API and worker run on Node 22 | Simpler than Nx. Bun as runtime for Nest/BullMQ/Prisma is a compatibility risk we do not need (changed from pnpm on 2026-09-19 at the user's request) |
| Chunk text | In Postgres. Qdrant holds vector + small payload | Vectors are disposable and re-embeddable. Citations read from Postgres |
| Tenant isolation | Single Qdrant collection, indexed `workspace_id` payload, enforced server-side, tested | Standard multitenancy pattern. `workspace_id` never comes from the client |
| Provider | Thin `LlmClient` / `EmbeddingClient` interfaces, Gemini free tier first | Only early abstraction allowed. Lets us swap providers |
| Streaming | SSE | Simpler than WebSockets for one-way token streaming |
| Hybrid search | Postgres full-text + vector, merged with Reciprocal Rank Fusion in code | More transparent than a built-in option. Check Qdrant's current features at M11 |
| Reranking | Decide at M11. Leaning to a hosted cross-encoder, with an LLM rerank as comparison | Free-tier availability must be checked then |
| Auth | Email + password, JWT in httpOnly cookie | User knows auth. It is the base for tenant isolation, not a learning goal |
| ORM | Prisma | User already knows it |

Model names, embedding dimension and free-tier limits, verified 2026-09-19 against the live API with the user's key (`bun run --cwd apps/api list:models`, then real calls):
- **Generation model: `gemini-3.5-flash-lite`** (answers, query rewriting). Chosen from the real quota table below: 15 RPM and 500 RPD. It has no thinking tokens and is the fastest of the callable models. `gemini-3.6-flash` was tried first and dropped: its free quota is 20 requests per day, too small to develop against or to run an eval.
- **Planned roles for other models** (quotas are per model, so they do not compete):
  - LLM judge in M10: `gemini-3.1-flash-lite` (500 RPD). A different model from the generator reduces self-preference bias, though both are Flash Lite family, so state that limit.
  - Hand spot-check and "quality ceiling" comparison: `gemini-3.6-flash` (20 RPD is enough for 15 to 20 answers).
  - `gemini-3.7-flash`, `gemini-3.8-flash` and `gemini-3.5-flash` also have 20 RPD and think by default. `gemini-2.5-flash` and `gemini-2.5-flash-lite` are listed by the API but return 404 and show 0/0/0 quota for this account. Never trust the model list alone, call the model.
- **Thinking:** these models can spend hidden "thought" tokens that count against `maxOutputTokens`. With a small cap they can return an empty answer. The client defaults `thinking` to `minimal` (0 thought tokens observed on `gemini-3.6-flash`). `low` cost 286 thought tokens on one test prompt and truncated the visible answer.
- **Embedding model: `gemini-embedding-2`** (stable, 8,192-token input, native 3,072 dims, truncation to 768/1,536 is supported and re-normalized by the API). `gemini-embedding-001` (2,048-token input) and `gemini-embedding-2-preview` also exist for this key.
- **Embedding dimension: 768.** Smaller vectors mean less Qdrant memory and faster search. Quality vs 1,536 or 3,072 is untested, so it can be measured in M6. Changing it means re-embedding everything.
- **Batching trap:** for `gemini-embedding-2`, a plain `string[]` is merged into ONE embedding. Each text must be its own `{ parts: [{ text }] }` entry. The client does this and the smoke test guards against it.
- **Task types:** `gemini-embedding-2` takes no `taskType`, so the client writes the task into the text (`task: search result | query: ...` for queries, `title: none | text: ...` for documents). `gemini-embedding-001` still uses `taskType`. The exact wording is a tunable to measure in M6.
- **Free-tier limits** (read by the user from the AI Studio rate-limit page on 2026-09-19, project "Gemini Project"). Google does not publish these as fixed numbers in the docs, so re-check them before any milestone that depends on volume:

  | Model | RPM | TPM | RPD |
  |---|---|---|---|
  | `gemini-3.5-flash-lite` | 15 | 250K | 500 |
  | `gemini-3.1-flash-lite` | 15 | 250K | 500 |
  | `gemini-3.5-flash`, `3.6-flash`, `3.7-flash`, `3.8-flash` | 5 | 250K | 20 |
  | Embedding row labelled "Gemini Embedding 1" | 100 | **30K** | 1,000 |

  - The embedding row is labelled "Embedding 1". No "Embedding 2" row was visible. Unconfirmed whether `gemini-embedding-2` shares that quota. Plan as if it does.
  - **Embedding TPM (30K) is the binding limit.** About 60 chunks of 500 tokens per minute. A corpus of a few thousand chunks takes tens of minutes, and M6 re-embeds it for each chunking strategy. Embedding cache by content hash is required, not optional. The embedding pipeline in M5 needs a token-based limiter, not only a request-based one.
  - **Eval budget:** one M10 run is about 50 questions x (1 answer + 3 judge calls) = 200 calls. At 15 RPM that is about 14 minutes and 40% of one model's daily quota. Judge and generator use different models, so their daily quotas are separate.
  - The quota belongs to the Google project, not the API key. Anything else running on that project counts against it.
  - Client limiters are set a little under the limits: `GEMINI_GENERATION_RPM=12`, `GEMINI_EMBEDDING_RPM=80`. Limiters are per model and in-process. A Redis-backed shared limiter is needed once the worker is a separate process (M4 and M13).
- Smoke test result (real run): related text scored 0.79 cosine against the query, unrelated text 0.59. Unrelated text is nowhere near 0, so a fixed score threshold cannot be guessed. It must be measured (M6).

### Data model (first draft)

`User`, `Workspace`, `Membership(user, workspace, role)`, `Document(workspace, status, storage_path, content_hash, ...)`, `Chunk(document, workspace, index, text, token_count, page, heading, content_hash)`, `Conversation(workspace, user)`, `Message(conversation, role, content, citations, usage)`, `AiUsage(workspace, operation, model, input_tokens, output_tokens, cost_estimate, latency_ms)`, `EvalDataset`, `EvalQuestion`, `EvalRun`, `EvalResult`.

## 3. Learning objectives

By the end the user can explain and defend in an interview:
1. Tokens, context windows and embeddings, and how they drive cost and quality.
2. Why chunking choices change retrieval quality, and how to prove it with numbers.
3. Vector, keyword and hybrid retrieval, and why reranking exists.
4. How to force grounded answers with citations, and why prompts alone cannot stop hallucination.
5. How to measure a RAG system and where LLM judges are unreliable.
6. How prompt injection works against RAG and which defenses actually reduce it.
7. How to run AI workloads in production: async jobs, retries, cost tracking, rate limits.

## 4. Milestones

Change from the original list: the **mini eval harness moved to M6**. Chunking experiments, hybrid search and reranking cannot be judged without it. Full eval stays a later milestone.

Hour estimates include the learning exercises. Rough total about 130 hours, about 13 weeks at 10 hours per week.

| # | Milestone | Concepts learned | Learning doc | Est. hours |
|---|---|---|---|---|
| 1 | Architecture and setup: monorepo, Docker Compose (Postgres, Qdrant, Redis), config, provider interfaces, verify Gemini models and limits | Provider abstraction, free-tier constraints | | 4 |
| 2 | Auth and workspaces | Tenant model, access control (foundation for M12) | | 8 |
| 3 | Document upload and storage | File validation, size limits, content hashing | | 6 |
| 4 | Processing worker: extraction, cleaning, BullMQ, retries, failed jobs, status flow | Text extraction pitfalls, async AI workloads | 09 starts | 10 |
| 5 | Chunking and embeddings | **Tokens, embeddings, dimensions, cosine similarity, semantic vs keyword search, chunk size and overlap** | 01, 02, 03 | 12 |
| 6 | Qdrant retrieval + mini eval | Top-K, score thresholds, metadata filtering, precision/recall. **Chunking experiment**: fixed vs paragraph vs heading-aware, compared by hit rate@k and MRR | 05 | 12 |
| 7 | Basic RAG | Context construction, system/user instructions, temperature, streaming, cost and latency tracking, "I don't know" handling | 04 | 10 |
| 8 | Citations | Structured outputs, JSON schema, citation verification, source-passage viewer in the UI | | 8 |
| 9 | Conversational RAG | Conversation state, context window limits, query rewriting, history compaction, **tool calling basics** (model decides whether to retrieve) | | 10 |
| 10 | Full evaluation: 50-question dataset, faithfulness, answer relevance, citation correctness, dashboard | LLM-judge limits, eval design | 07 | 14 |
| 11 | Hybrid search and reranking, measured before/after against the M10 baseline | Keyword vs semantic, RRF, cross-encoders | 06 | 10 |
| 12 | Security: prompt injection demos and defenses, malicious documents, tenant-leakage tests, input/output validation | Prompt injection, data leakage, why prompts alone are not enough | 08 | 10 |
| 13 | Production hardening: rate limiting, usage and cost tracking, logging, error handling, basic tests, API docs | Production AI operations | 09 completes | 10 |
| 14 | Deployment and documentation: README, architecture diagram, case study, resume bullets, Upwork description | | 10 | 8 |

## 5. Not included

Microservices, Kubernetes, fine-tuning, self-hosted LLMs, agents (Project 2), OCR/scanned PDFs/tables/images (Project 5), LangChain/LlamaIndex in the core, GraphRAG, SSO/OAuth, email verification, password reset, Stripe billing (Project 3), Postgres row-level security (stretch), connectors, document versioning, semantic caching, multi-language. Known limitation to note in docs: PDFs with tables and scans extract poorly.

## 6. Evaluation design

- Corpus: 5 to 8 public documents in one domain (recommended: a publicly licensed company handbook or open-source docs). Record every license.
- 50 questions: about 35 single-chunk answerable, about 8 multi-chunk, about 7 unanswerable.
- LLM proposes candidates, the user curates and writes expected answer and source.
- Metrics from stored runs only: hit rate@k, MRR, answer relevance, faithfulness, citation correctness.
- Stated limits of LLM judges. Hand spot-check of 15 to 20 answers.

## 7. Open items

- [ ] Verify current Gemini generation model, embedding model, dimension and free limits (M1)
- [ ] Choose the demo corpus and record licenses (before M6)
- [ ] Decide reranking approach (M11)
- [ ] Check Qdrant's current hybrid/multitenancy guidance (M6 and M11)

## Embedding model facts, verified 2026-09-20 (Milestone 5, Checkpoint A)

Source: the Gemini embeddings docs page (read through a fetch tool), plus real calls with `bun run lab:embeddings`.

- `gemini-embedding-2`: 8,192 input tokens per text. Output 128 to 3072 dimensions, default 3072, recommended 768, 1536, 3072. We use 768 (`EMBEDDING_DIMENSIONS`).
- No `task_type`. Query or document intent is written into the text (`task: search result | query: ...`), which `GeminiEmbeddingClient` does through its `purpose` argument. The exact wording is to be tested in the M6 evaluation.
- Vectors below 3072 dimensions come normalised (measured length 1.0000 at 768), so cosine similarity equals the dot product.
- Several texts in one call must be separate content entries, or the API returns one merged vector.
- `countTokens` accepts `gemini-embedding-2`. The embed call itself does not report token counts.
- Measured: characters / 4 over-estimates English prose by up to about 19% and under-estimates codes and numbers by up to 72%. See `docs/learning/milestones/M05-chunking-and-embeddings/checkpoint-a-results.md`.
