# Milestone 7: Basic RAG

**Status:** done, 2026-09-23. All three checkpoints built, tested, and confirmed live in your own browser. Quiz open (never blocks anything). Next: Milestone 8 (Citations), which starts with concepts and a plan for you to read.
**Time budget:** about 10 hours (from `docs/PLAN.md`).

## Goal

Turn retrieved chunks into a written answer. No citations yet (Milestone 8), no conversation history yet (Milestone 9), no prompt-injection hardening yet (Milestone 12). This milestone is the plain path: question in, grounded answer out, with sources returned as data and basic honesty about what the documents do and do not say.

```
question --embed--> Qdrant (top K, this workspace) --> Postgres (chunk text)
                                                              |
                                          numbered context (capped by a token budget)
                                                              |
                               system instruction (grounding rule) + user turn (context + question)
                                                              |
                                                    Gemini generate()
                                                              |
                              answer text, checked for the fixed refusal phrase -> noAnswer
                                                              |
                          { answer, sources: [...chunks used...], usage: {tokens, retrievalMs, generationMs} }
```

## Read first

1. [`concepts.md`](concepts.md): six concepts taught before any code (context construction, system vs. user instructions, temperature, streaming, cost and latency tracking, "I don't know" handling).
2. `apps/api/src/llm/types.ts` and `apps/api/src/llm/gemini/gemini-llm-client.ts`: the generation client already built in Milestone 1. This milestone is the first to call it for real.
3. [`checkpoint-b-results.md`](checkpoint-b-results.md): the plain answer endpoint, verification, and the first sign of Gemini's latency.
4. [`checkpoint-c-results.md`](checkpoint-c-results.md): the streaming design, the proxy bug found and fixed, what the live checks did and did not prove, and the browser check that is now your part.

## Plan

Three checkpoints. I stop at each one, show you the result, and wait.

**Checkpoint A: design (this document, no code)**
- [x] A1. You confirmed all the decisions below as recommended.

**Checkpoint B: the answer endpoint, no streaming**
- [x] B1. `buildContext`: numbers retrieved chunks, labels each with its document name, caps the total by a token budget (drops the lowest-scoring chunks beyond the cap). Pure function, tested with a property test like the chunkers.
- [x] B2. Fixed system instruction (grounding rule, the exact refusal phrase, what to do about instructions found inside a chunk) and the user prompt template.
- [x] B3. `RagService.answer()`: retrieve through the existing Qdrant search, skip the LLM call and return the refusal directly if nothing is retrieved, otherwise call `generate()` at temperature 0.2, check the reply for the refusal phrase, return the answer, the sources used, and usage (tokens, retrieval time, generation time).
- [x] B4. `POST /ask`, workspace-scoped the same way every tenant route is (`@CurrentWorkspace()`, no new parameter for it). No new database table.
- [x] B5. A `FakeLlmClient` for tests (same shape as `FakeEmbeddingClient`), and tests: workspace isolation, zero chunks skips the LLM call, the refusal phrase sets `noAnswer`, the context budget actually caps, temperature and model are passed through, usage numbers are present and add up.
- [x] B6. Live check with real Gemini against the Acme demo documents ("Expense policy (sample).txt" etc.): an answerable question got a correct, grounded, concise answer with real sources; an unanswerable one got the exact refusal phrase. Real tokens and latency recorded below, not estimated.

**Checkpoint C: streaming and a minimal web page**
- [x] C1. A streaming version of the same call (`generateContentStream`), sent to the browser over SSE. Retrying only covers opening the stream, never a piece already sent. The custom failure event is named `failed`, not `error`, so it cannot collide with the browser's own connection-error handling.
- [x] C2. The Ask page in `apps/web` (`FRONTEND_RULES.md` followed): a question box, the answer streaming in with a Stop button and a cursor, a plain sources list, and a closed-by-default Details disclosure with model, timings, tokens and similarity scores in mono.
- [x] C3a. Live check found and fixed a real bug: the generic `/api/*` proxy killed the SSE connection after about 150ms. Fixed with a dedicated streaming Route Handler, reverified four times.
- [x] C3b. You checked it live in your own browser (2026-09-23) and confirmed it works.
- [x] C3c. Topic note `04-rag.md`, Milestone 7 quiz (6 questions) and exercises (3) in `QUIZ.md`, `PROGRESS.md`, `DEMO_GUIDE.md` (check U), the milestone index.

## Decisions (change any of these at Checkpoint A)

| Decision | Choice | Why | Cost |
|---|---|---|---|
| Temperature | 0.2 | A grounded factual answer should track the source closely, not vary creatively | Answers are a little more repetitive across near-duplicate questions, which is fine here |
| How many chunks | 5 (same `K` as the evaluation harness) | Keeps the number comparable to what Milestone 6 already measured for retrieval | A harder question that truly needs more than 5 passages gets a worse answer. Milestone 10's fuller evaluation can test this |
| Context cap | A token budget as a constant in code, not a new `.env` setting | It is a safety valve (one long chunk should never silently crowd out the others), not something to tune per environment | If it ever needs tuning per deployment, promoting it to an env var is a small change |
| "I don't know" | A fixed refusal phrase in the system instruction, checked in the reply, exposed as `noAnswer: boolean` | Milestone 6 showed a score cutoff cannot tell answerable from unanswerable reliably. Grounding by instruction, not by score, is the only thing that measured well enough to try | Freeform text matching a phrase is weaker than a structured, verified answer. Milestone 8 replaces this properly |
| Streaming | Built in Checkpoint C, on top of a non-streaming path built and tested first | Keeps the pipeline "document -> chunks -> ... -> answer" visible and testable in one plain call before adding the more complex streaming layer | Two code paths to keep working, though they share the same service underneath |
| Cost tracking | Token counts and latency returned with every answer. No dollar figure, no persistence | Free-tier pricing is not meaningful to show, and persisted usage tracking is explicitly Milestone 13's job | The response has "how much" (tokens, time) but not "how expensive" until Milestone 13 |
| Persistence | The Q&A is not saved anywhere in this milestone | Milestone 9 (conversational RAG) is what adds conversation storage. Building it twice would be wasted work | No history yet: every question is answered alone, with nothing remembered |
| New module | `apps/api/src/rag/` (service, prompt builder, controller) | Matches the existing shape of one small module per responsibility | One more folder in `src/` |

One free-tier fact worth knowing before the live checks: `GEMINI_GENERATION_RPM` is pinned at 12 in your `.env`. That is 12 answer calls per minute. The existing rate limiter and retry (Milestone 1) already handle it, but it means clicking through many test questions quickly during Checkpoint C will pause between some of them.

## What you should be able to explain at the end

1. Why the grounding rule belongs in the system instruction and not the user prompt.
2. Why Milestone 6's finding (score ranges overlap) ruled out a score-based "I don't know," and what replaced it.
3. What streaming buys you, and what it costs in code.
4. Why token counts and latency are tracked now, but dollar cost is not yet.
5. What is deliberately left out of this milestone, and which later milestone picks it up.

## Files this milestone touched

`apps/api/src/rag/` (new), `apps/api/src/llm/` (a streaming method, the `LLM` DI token), `apps/api/test/` (new tests, `FakeLlmClient`), `apps/web/src/components/ask-view.tsx` and `apps/web/src/app/(app)/ask/page.tsx` (the page), `apps/web/src/app/api/ask/stream/route.ts` (the streaming proxy fix, not in the original plan), `apps/web/src/components/app-shell.tsx` (nav entry), `docs/learning/milestones/M07-basic-rag/`.

## Your part

- ~~Confirm or change the decisions at Checkpoint A.~~ Done.
- ~~The browser check.~~ Done, 2026-09-23: confirmed working.

## After the milestone

Quiz and exercises go into `docs/learning/QUIZ.md` under "Milestone 7". The topic note is `04-rag.md` in this folder.
