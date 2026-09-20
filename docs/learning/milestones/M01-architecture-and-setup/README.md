# Milestone 1: architecture and setup

**Status:** built. Quiz parked until Milestone 5 (question 1 is worth answering before then).

## Goal

A working foundation: monorepo, Docker services, API and web skeletons, a typed and rate-limited way to call Gemini, and a UI design system, so later milestones only add features.

## What was built

- Bun workspace: `apps/api` (NestJS on Node 22), `apps/web` (Next.js 16), `eval/`.
- Docker Compose: Postgres 17 (host port 5433), Qdrant, Redis.
- Zod env loader that fails at start-up if configuration is wrong.
- `LlmClient` and `EmbeddingClient` interfaces, a rate limiter, retry with backoff, usage records, and the Gemini implementations (`apps/api/src/llm/`).
- shadcn/ui with a fixed design system and written frontend rules (`docs/FRONTEND_RULES.md`).
- Chosen models: `gemini-3.5-flash-lite` for generation, `gemini-embedding-2` with 768 dimensions for embeddings. Limits are recorded in `docs/PLAN.md`.

## Read

- `docs/PLAN.md`: architecture, models, free-tier limits, milestone table.
- [`../../09-production-ai.md`](../../09-production-ai.md): provider interfaces, rate limits, retries, thinking tokens, embedding batching.
- `docs/FRONTEND_RULES.md`

## Quiz

`docs/learning/QUIZ.md`, section "Milestone 1".

## Open

- Quiz unanswered.
