# Checkpoint B results (2026-09-22)

The answer endpoint is built: question in, grounded answer out, no streaming yet.

## What was built

```
question -> RagService.answer()
              1. embed the question, search Qdrant (top 5, this workspace, the configured strategy)
              2. nothing retrieved? return the refusal directly, no model call
              3. buildContext: number the hits, label with document + page, stop before the token budget is passed
              4. generate() at temperature 0.2, system instruction with the grounding rule and the exact refusal phrase
              5. check the reply for that phrase -> noAnswer
              6. return { answer, noAnswer, sources: [only the chunks actually shown], usage: {tokens, retrievalMs, generationMs} }
```

| Piece | Where |
|---|---|
| Prompt building (pure functions) | `apps/api/src/rag/prompt.ts` |
| The service | `apps/api/src/rag/rag.service.ts` |
| `POST /ask` | `apps/api/src/rag/rag.controller.ts`, `rag.module.ts` |
| Request validation | `apps/api/src/rag/rag.schemas.ts` (Zod, same pattern as auth) |
| Generation provider wired into Nest | `apps/api/src/llm/llm.module.ts`, `llm.tokens.ts` (mirrors the embedding provider's wiring) |
| Fake for tests | `apps/api/test/fake-llm.ts` |

## The design in practice

- **Sources are only ever the chunks actually shown to the model.** `buildContext` can drop the lowest-scoring hits once the token budget is passed, and the API only reports what made it into the prompt, not everything retrieval found. A test constructs the service with a deliberately tiny budget (bypassing the real one, which is hard to exceed with 5 real chunks, as noted below) and proves a dropped chunk's text never reaches the model and its name never reaches the response.
- **Zero chunks retrieved skips the model call entirely.** Nothing is paid for an answer that is already known.
- **The refusal phrase is the same string in three places, on purpose:** the system instruction tells the model to use it exactly, the reply is checked for it with `startsWith`, and it is also the constant returned directly for the zero-chunks case. A test confirms the system prompt really contains the exact phrase, so the two cannot drift apart.
- **The context token budget (4,000) is a safety valve, not a real limit under current settings.** Our chunks average 400 to 500 tokens, and retrieval is capped at 5, so five real chunks total at most around 3,100 tokens even at their largest. It essentially cannot trigger with the current corpus and chunk sizes. Proven with real data in the tests below.
- **`RAG_TOP_K` is imported from the evaluation harness's `EVAL_K`, not redefined.** The same 5 in both places, so retrieval numbers measured in Milestone 6 describe what this endpoint actually uses.
- **The route is protected exactly like every other tenant route**, no workspace id in the body, `@CurrentWorkspace()` only.

## Tests

- **9 unit tests** for `buildContext` and `buildUserPrompt` (no database, no network): numbering, labelling, keeping everything under budget, dropping the lowest scorers over budget, always keeping the first hit even alone it is over budget, never claiming a chunk as used that is not in the text, and the refusal phrase being present inside the system prompt.
- **7 end-to-end tests**, against the real Postgres and Qdrant with a fake LLM: a grounded answer with the right prompt shape and settings, isolation (a workspace never sees another's chunks or text), the zero-hits shortcut, the model's own refusal is detected, invalid questions are rejected before any call, the route requires a session, and (constructing the service directly with a tiny budget) a dropped chunk is dropped everywhere, not just from the prompt.
- **10 deliberate breaks, all caught:** the budget check removed, the "always keep the first hit" rule removed, passages renumbered incorrectly after a drop, the refusal phrase separated from what the system prompt promises, sources including dropped chunks, the model called even with nothing retrieved, the refusal never detected, temperature not passed, the question left unvalidated, the route made public. Two of these needed a fix before they were real: "sources including dropped chunks" needed a new e2e test (see below, the tiny-budget one), and "the route made public" was first missed only because my own mutation script edited the file without actually applying the `@Public()` decorator; once the script was fixed, the real code caught it.
- 328 API tests pass in total (328 = 312 before this checkpoint, 16 new). Typecheck is clean.

## The live check (real Gemini, Acme Corp's demo documents)

Signed in as `alice@acme.test`. Documents: "Expense policy (sample).txt", "Remote work guidelines (sample).txt", "Benefits summary (sample).docx", "Employee handbook (sample).txt" (all fictional, all already Ready and embedded from earlier milestones).

| Question | Result |
|---|---|
| "How much money can I claim for setting up my desk at home?" | **Correct, grounded, concise:** "You receive a one-time home office allowance of 400 dollars." Sources: Remote work guidelines, Expense policy, Benefits summary, Employee handbook (all four retrieved, all within budget). `noAnswer: false`. |
| "What is the policy on pets in the office?" | **Correctly refused**, exact phrase, `noAnswer: true`. |

Real usage numbers, read from the API's own usage log:

| Question | Attempts | Input tokens | Output tokens | Retrieval time | Generation time |
|---|---|---|---|---|---|
| Desk allowance | 4 (3 retried) | 624 | 16 | 1,359 ms | 115,653 ms |
| Pets policy | 1 | 620 | 12 | 955 ms | 59,323 ms |

**This is slower than I expected, and I want to say so plainly rather than gloss over it.** Both answers were correct, and the backoff itself only accounts for a few seconds of the first call's total (base delay 1 s, cap 30 s, three retries caps out around 7 s of waiting). The rest of both calls, including the one that succeeded on the first attempt, was spent inside the `generateContent` call itself. I do not know why `gemini-3.5-flash-lite` took roughly one to two minutes here: it could be normal for this model at this time, a free-tier queueing effect, or something else. I have not investigated further, because that is a production-hardening question (Milestone 13 covers rate limiting and usage tracking in depth), and I do not want to state a cause I have not checked. What this means for the demo: an answer will visibly take a while to appear without streaming, which is itself one more reason Checkpoint C's streaming matters, so the person asking sees the model working instead of a long silent wait.

## Costs and surprises

- **A one-line coverage gap, closed properly, not worked around.** A deliberate break showed that nothing proved `sources` used the token-budget-filtered list rather than the full retrieved list. The real budget cannot be exceeded by 5 real chunks under current settings, so I added an optional constructor parameter to `RagService` (unused by the normal DI-wired path, defaulting to the real constant) purely so a test can build the service with a tiny budget and prove the dropped chunk is dropped everywhere. This is a testing seam, not a new setting.
- **The mutation script itself had a bug.** One mutation (making the route public) was a malformed string replacement that never actually applied the `@Public()` decorator, so its MISSED result was meaningless, not a real gap. I found this by reading why the break did not fail any test, fixed the script, and reran it to confirm the real code catches it.
- **`GEMINI_GENERATION_RPM=12` was not the bottleneck here.** These were the first generation calls of a freshly started process, so the limiter had nothing to wait for; the slowness was inside the calls themselves.

## Known gaps, on purpose

- No streaming yet (Checkpoint C).
- No structured, verified citations, only a freeform refusal phrase (Milestone 8).
- No conversation history (Milestone 9).
- No dollar cost tracking (Milestone 13).
- The generation latency is unexplained. Worth watching, not yet investigated.

## Questions for you

1. **Go for Checkpoint C** (streaming and a minimal Ask page)?
