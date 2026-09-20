# AI Knowledge Platform

Project 1 of the GenAI portfolio program. Read the parent `../CLAUDE.md` first (role, teaching procedure, milestone protocol, hard rules). This file adds project-specific decisions.

**Current state:** Milestones 1 to 4 are built and checked. Milestone 5 (chunking and embeddings) is in progress: plan, checkpoints and status are in `docs/learning/milestones/M05-chunking-and-embeddings/README.md`. `docs/PROGRESS.md` has the exact state and open items. Do not skip ahead. Full plan is in `docs/PLAN.md`. To click through what exists: `docs/DEMO_GUIDE.md`.

## What we are building

A production-style, multi-tenant SaaS where users upload company documents (PDF, DOCX, TXT) and ask questions about them, getting answers with citations.

```
upload -> processing job -> text extraction -> cleaning -> chunking -> embeddings
       -> vector storage -> retrieval -> (rerank) -> LLM -> answer + citations -> conversation history
```

It must be realistic enough to demo to Upwork clients as an enterprise RAG application. The differentiators are **measured quality** (evaluation pipeline with real numbers), **tenant isolation**, and **demonstrated prompt-injection defenses**.

**UI matters for the demo** (user decision, 2026-09-19), so it follows `docs/FRONTEND_RULES.md` (binding, read it before any UI work). The quality comes from the design system (shadcn tokens, fixed fonts, states, rules), not from per-screen polish. The UI serves three demo moments: cited answers with a source panel, document pipeline status, and eval results. UI time stays inside each milestone's hour estimate.

## Stack (decided)

| Layer | Choice |
|---|---|
| Frontend | Next.js 16, TypeScript, Tailwind 4, **shadcn/ui** (`radix-nova`, Lucide). Design tokens in `apps/web/src/app/globals.css`. Fonts: Public Sans (UI), Newsreader (answers and passages), JetBrains Mono (numbers). Rules: `docs/FRONTEND_RULES.md` |
| Backend | NestJS, TypeScript, modular monolith (no microservices) |
| ORM / DB | Prisma + PostgreSQL |
| Vector DB | Qdrant |
| Queue / cache | Redis + BullMQ |
| AI provider | **Gemini free tier** behind `LlmClient` / `EmbeddingClient` interfaces |
| Infra | Docker Compose |
| Repo layout | Bun workspace (package manager and script runner only): `apps/web`, `apps/api` (API and worker are separate entrypoints of the same codebase), `eval/`, `docs/` |
| Runtime | NestJS API and worker run on **Node 22**, not Bun. BullMQ/ioredis, Prisma and Nest target Node. Bun runs one-off scripts (`smoke:gemini`, `list:models`, later eval scripts) |
| Streaming | SSE from NestJS to Next.js |
| Extraction | Node libraries (`pdfjs-dist`, `mammoth`). No Python. |

Python is only allowed if a specific AI/document task clearly needs it and Node cannot do it. Currently nothing does.

## Architecture rules

- Modules (separate responsibilities, plain services): auth, workspaces, documents, ingestion, chunking, embedding, retrieval, reranking, llm, conversations, evaluation.
- **Postgres is the source of truth.** Chunk text lives in Postgres. Qdrant holds vectors plus a small payload (`workspace_id`, `document_id`, `chunk_id`, `chunk_index`, page/heading if known). Vectors must be disposable and rebuildable from Postgres.
- **Tenant isolation:** one Qdrant collection with indexed `workspace_id` payload filter. `workspace_id` always comes from the authenticated session server-side, never from the client. Every retrieval path applies the filter. Isolation is covered by automated tests.
  - **How it works (built in M2):** the session cookie is a JWT with `sub` (user) and `wid` (active workspace). The `wid` is only a claim: the global `SessionGuard` (`apps/api/src/auth/session.guard.ts`) re-reads the membership row on every request, so removals and role changes apply on the next request. Roles are not stored in the token.
  - **Secure by default:** every route needs a session and membership in the active workspace. Routes opt out with `@Public()` or narrow with `@UserOnly()` and `@Roles(...)`. Tenant-data routes take the workspace from `@CurrentWorkspace()`, never from a URL, body, query or header. New endpoints must not add a workspace id parameter.
  - **Scoped client (built in M3):** tenant-owned tables (documents now; chunks, conversations, eval data later) are read and written only through `forWorkspace()` in `apps/api/src/prisma/tenant-client.ts`, obtained with `TenantPrismaService.for(actor)`. It injects `workspace_id` into every query and create, drops any attempt to set or change it, and refuses operations it does not know. No raw SQL and no plain-client access on tenant tables (a test scans `src/` for raw queries). A new tenant table must be added to `TENANT_MODELS` (a test fails if it is missing, or if a model with a `workspaceId` is neither tenant nor exempt) and gets a cross-tenant test.
  - **Uploads (built in M3):** files sit on local disk behind `StorageService` (`apps/api/src/storage/`), key `<workspaceId>/<documentId>`, default folder `<project>/storage` (git-ignored). A file's type is decided from its bytes (`documents/file-type.ts`), never from its name or the browser's type. Limit `MAX_UPLOAD_MB` (10). The web proxy has its own body limit in `apps/web/next.config.ts` that must stay above it.
  - **System queries (M4):** the worker's sweeper must look across workspaces to find stuck documents. That is the ONE place allowed to use the plain client on a tenant table: `apps/api/src/worker/system-queries.ts`, ids only. Everything a job does with a document goes through `forWorkspace()` using the workspace id carried in the job, set by the server when the job is created. A test fails if the plain client touches a tenant table anywhere else in `src/`. Several writes that must succeed together use `db.transaction()`, which is scoped too.
  - **Tests:** `bun run test` (real Postgres `akp_test`, never the dev database). Isolation tests are mutation-checked: removing the membership check or the workspace filter makes them fail.
- **AI must not block HTTP requests.** Upload returns immediately, creates a BullMQ job, the worker processes it, status is updated (`uploaded -> processing -> ready | failed`), and the frontend polls or subscribes.
- **Processing (built in M4):** upload saves the file and row (status `UPLOADED`), adds a BullMQ job `{documentId, workspaceId}` (`queue/`), and returns. A separate worker process (`bun run worker`, `worker/`) runs `DocumentProcessorService` (`processing/`): read the file, extract (pdfjs per page, mammoth, text), clean, save one `DocumentPage` row per page and mark `READY` in one transaction. Problems with the file (no text, damaged, too big, password) are `PermanentProcessingError`: `FAILED` at once with a plain reason. Anything else is temporary: BullMQ retries 3 times, then `FAILED`. The processor must stay safe to run twice. The sweeper re-queues documents stuck for over 5 minutes. OCR, tables and images are out of scope. Limits: `MAX_PDF_PAGES` 300, `PROCESSING_TIMEOUT_SECONDS` 60, 3 million characters, zip-bomb guard.
- **Keep the pipeline visible.** The first RAG implementation must show document -> chunks -> embeddings -> vectors -> retrieval -> context -> LLM -> answer as plainly readable code. Only the provider interfaces are abstracted early.
- Embedding dimension is set by the embedding model and stored in config. Changing the embedding model means re-embedding everything (teach this at M5).
- Cache embeddings by content hash. This matters for free-tier limits and for rerunning experiments.

## Gemini free-tier constraints

- Rate limits and daily quotas are small. The LLM client needs retry with backoff, a request queue or limiter, and usage logging from day one.
- Verify the current model names, embedding model, dimensions and limits in the official docs at Milestone 1 (as of my knowledge, `gemini-embedding-001` was the embedding model; check). Do not rely on this file for them. Record what was chosen in `docs/PLAN.md`.
- Pin exact model versions in the eval config so results are reproducible. Avoid `-latest` aliases for evaluated runs.
- Free-tier data may be used by the provider, so use **public documents only**.

## Evaluation rules

- A **mini eval harness arrives at Milestone 6** (about 20 questions, retrieval hit rate@k and MRR). It is used to compare chunking strategies. Hybrid search and reranking (M11) are judged against the baseline from the full eval (M10).
- **Full eval dataset (M10): 50 questions** built from the demo corpus: about 35 answerable from one chunk, about 8 needing several chunks, about 7 unanswerable (to test refusals). Questions are LLM-proposed then **human-curated** by the user, who writes the expected answer and source. Fully synthetic sets are too easy.
- Metrics: retrieval hit rate, MRR, answer relevance, faithfulness/groundedness, citation correctness. Store every run (config, model versions, per-question results) in the DB and as committed JSON under `eval/runs/`. Numbers in docs come only from these runs.
- LLM-judge limitations must be stated: self-preference bias, position bias, inconsistency. Spot-check 15 to 20 answers by hand and report agreement.
- Keep evaluation in TypeScript. Frameworks like Ragas (Python) are out unless later added as a comparison.

## Demo corpus

5 to 8 **public** documents in one domain. Recommended: a publicly licensed company handbook (for example pages of a public handbook under a Creative Commons license) or open-source project documentation. **Check and record the license** of every document used. Also write a few deliberately malicious documents ourselves for the M12 prompt-injection demos.

## Documentation to maintain

`docs/learning/` gets one file per topic, created when the milestone that teaches it is done: `01-llm-fundamentals`, `02-embeddings`, `03-chunking`, `04-rag`, `05-retrieval`, `06-reranking`, `07-evaluation`, `08-prompt-injection`, `09-production-ai`, `10-lessons-learned`. Each contains: Concept, Why it matters, Mental model, Example, What we implemented, Tradeoffs, Common mistakes, Interview questions. Keep them concise and practical. Extras beyond that list: `docs/learning/file-uploads.md`, `docs/learning/tenant-isolation.md` and `docs/learning/QUIZ.md` (every pending quiz question and exercise with a place for the user's answer and a hidden answer key, add new questions there at the end of each milestone). `docs/learning/README.md` indexes them.

At the end: `README.md` (architecture diagram, features, screenshots, API docs, local setup, deployment, RAG pipeline, evaluation results, security, decisions, limitations), `docs/portfolio-case-study.md`, `docs/resume-bullets.md` (3 to 5 bullets, only real things), `docs/upwork-description.md`.

## Out of scope (do not add without asking)

Microservices, Kubernetes, fine-tuning, self-hosted LLMs, agents, OCR and scanned PDFs, tables/images, LangChain/LlamaIndex in the core, GraphRAG, SSO/OAuth, email verification, password reset, Stripe billing, Postgres row-level security (stretch only), connectors, document versioning, semantic caching, multi-language.

## Commands (from the project root)

```
bun install
bun run infra:up                      # Postgres 5433, Qdrant 6333, Redis 6379
bun run --cwd apps/api db:generate    # generate the Prisma client (needed after install and schema changes)
bun run --cwd apps/api db:migrate     # apply schema changes to the dev database
bun run seed                          # fake demo accounts and sample documents, see docs/DEMO_GUIDE.md (safe to repeat)
bun run api                           # NestJS on :3001 (loads the root .env)
bun run web                           # Next.js on :3000 (proxies /api/* to the API)
bun run worker                        # processing worker: reads uploaded documents (needs Redis and the database)
bun run samples                       # writes sample files to demo-files/ for manual uploads
bun run test                          # API tests against the akp_test database
bun run smoke:gemini                  # real Gemini calls, needs GEMINI_API_KEY
```

## Working agreement

- The user has about 10 hours per week.
- Start of every session: read `docs/PROGRESS.md`, tell the user where we are and what the next action is.
- Milestone 1 does not start until the user says so.
- Package manager is Bun (user's choice, replaces the earlier pnpm plan). Root `bun install`, scripts via `bun run`.
- Toolchain pins found in M1: Nest CLI 12 needs **TypeScript 6** (TypeScript 7 removed the compiler API the CLI uses). Do not upgrade `typescript` in `apps/api` until Nest supports 7. Postgres is on host port **5433** because 5432 is taken on the dev machine.
- **Background processes: stop the whole tree and check.** Never start a dev server in the background and assume it stopped. Killing the process on the port leaves `nest start --watch` alive. Stop the top process of the tree (`taskkill /F /T /PID <top>`), then list what is left. Match on the real command line (`nest\.js" start` has a quote in it). Look at parent chains before killing anything, and never stop a process the user started without asking. One API and one worker at a time.
- Verify the running process is the new build before testing against it: for an API, compare the response shape to what the new code returns.
- The worker compiles to `apps/api/dist-worker`, the API to `dist`. Do not point two watchers at one folder.
- The shell in a session may lack common tools (`grep`, `ls`). Use the dedicated Grep, Glob and Read tools, and PowerShell for processes.
- **Milestone folders (user request, 2026-09-20).** Every milestone has a folder `docs/learning/milestones/M<NN>-<name>/` (index: `docs/learning/milestones/README.md`). Before coding a milestone: teach its concepts, write `concepts.md` and a `README.md` there with the goal, the plan as a checklist with checkpoints, the decisions with their costs, and what the user should be able to explain at the end. Then stop and wait for the user's go. During the milestone tick the checklist as work is done. At the end put the milestone's topic notes in the same folder, link its quiz section in `docs/learning/QUIZ.md`, and update `docs/PROGRESS.md` and the index. Stop at each checkpoint so the user stays in control.
- **What may be sent to a provider (rule added 2026-09-20 after a mistake).** Anything a script, test or job sends to Gemini (embed, countTokens, generate) must be public or fictional: the seeded documents whose names contain "(sample)", files in `demo-files/`, the eval corpus, or invented text. Never select rows from the dev database without that filter: it also holds documents people upload by hand, and the free tier may use what it receives. When a new step will send stored text to a provider, say so to the user before running it.
