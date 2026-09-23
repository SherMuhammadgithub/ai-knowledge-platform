# RAG: from retrieved chunks to a written answer (Milestone 7)

## Concept

RAG (Retrieval-Augmented Generation) is retrieval (Milestones 5 and 6) plus one more step: giving the retrieved chunks to a language model and asking it to write an answer from them, instead of from its own trained knowledge. This note covers that last step.

## Why it matters

- Retrieval alone gives a person five ranked passages. Most people want a sentence, not a ranked list.
- A model's own trained knowledge is not this workspace's documents. Left alone, it will answer fluently and wrongly. Grounding is the discipline of stopping that.
- Everything about the answer's honesty is decided here: what it is allowed to use, what tone it takes, and what it does when the documents do not say.

## Mental model

```
question --embed--> Qdrant (top 5, this workspace) --> Postgres (chunk text)
                                                              |
                                          numbered context (capped by a token budget)
                                                              |
                               system instruction (grounding rule) + user turn (context + question)
                                                              |
                                                    Gemini generate()
                                                              |
                              answer text, checked for the fixed refusal phrase -> noAnswer
```

Nothing here is new machinery. Retrieval is the same code the evaluation harness measures. Generation is the same `LlmClient` built in Milestone 1 and never called for real until now.

## System instruction, not a plea in the question

The API already splits every call into a fixed `systemInstruction` and the specific `prompt`. The grounding rule ("only answer from what you're given") goes in the system slot because it must hold for every question, not be retyped and possibly weakened each time. The user turn is just the numbered passages and the question:

```
Passage 1 (handbook.txt, page 1):
Full-time employees get 25 days of paid annual leave.

Question: How many days of annual leave do full-time employees get?
```

## "I don't know" without a score

Milestone 6 measured this directly: the closest chunk's score for answerable questions (0.665 to 0.798) overlapped with unanswerable ones (0.627 to 0.717). No cutoff separates them cleanly. So this milestone does not try. The system instruction tells the model to reply with one fixed sentence if the passages do not answer the question, and the API checks the reply with `startsWith()`, exposing a plain `noAnswer: boolean`. Two cheaper cases sit next to this: if retrieval finds nothing at all, the fixed sentence is returned directly, no model call made; the sentence itself lives in one constant, used in three places, so the promise (what the system prompt says) and the check (what the code looks for) cannot drift apart.

This is a real weakness, on purpose, left for Milestone 8: a model can fail to say the exact sentence, and nothing here verifies the answer's claims against the passages it names.

## Streaming, and what it actually needed

`generate()` waits for the whole answer. `generateContentStream()` yields pieces as they arrive. The interesting part was not the happy path, it was two edge cases found by building and by a real live check:

- **Retrying only covers opening the stream.** Once one piece of text has reached the browser, a failure is not retried: that would start a fresh answer while part of the old one is already on screen.
- **A live check found the page stuck on "Searching your documents..." for a full minute**, because retrieval (under 2 seconds) had long finished and the page had no way to know generation (which took over a minute during a real Gemini demand spike) had started. The fix: the stream sends a `status` event ("retrieving", then "generating") before any answer text, so the UI can say what is actually happening.
- **The custom failure event is named `failed`, not `error`.** `EventSource` reserves the event name `error` for its own connection failures. A server-sent event also named `error` would land in the exact same browser listener, making a real failure indistinguishable from a dropped connection.
- **A live check also found a bug that had nothing to do with any of the above:** the app's generic `/api/*` proxy (used for every other request) killed the SSE connection after about 150 milliseconds, every time, regardless of the question. Sending the request straight to the API worked correctly. The fix was a dedicated Next.js Route Handler that explicitly streams the proxied response, not a change to the generic rewrite.

## What we implemented, and where

| Piece | File |
|---|---|
| `LlmClient.generate()` and `.generateStream()` | `apps/api/src/llm/types.ts`, `apps/api/src/llm/gemini/gemini-llm-client.ts` |
| Prompt building (pure functions) | `apps/api/src/rag/prompt.ts` |
| `RagService.answer()` and `.answerStream()` | `apps/api/src/rag/rag.service.ts` |
| `POST /ask`, `GET /ask/stream` (SSE) | `apps/api/src/rag/rag.controller.ts` |
| The Ask page | `apps/web/src/components/ask-view.tsx` |
| The streaming proxy fix | `apps/web/src/app/api/ask/stream/route.ts` |

## Tradeoffs

- **Temperature 0.2**, not 0 and not higher: a grounded answer should track the source closely, but 0 is not truly deterministic on most providers, and a small amount of freedom still reads naturally.
- **Top 5 chunks**, the same `K` the evaluation harness measures with, so retrieval numbers and this endpoint describe the same thing. A question that genuinely needs more than 5 passages gets a worse answer.
- **A token budget as a constant, not an env var.** It is a safety valve against one huge chunk crowding out the others, not something meant to be tuned per deployment.
- **No persistence.** Every question is answered alone. Milestone 9 adds conversation storage; building it twice would be wasted work.
- **No dollar cost tracking**, only tokens and timings. Free-tier pricing is not meaningful to show, and persisted usage tracking is explicitly Milestone 13's job.

## Common mistakes

- Putting the grounding rule in the user prompt, where it competes with the question instead of sitting above it.
- Trying to decide "I don't know" from a retrieval score. Milestone 6 measured why that fails.
- Reusing a browser-reserved event name (`error`) for a custom SSE event.
- Retrying a stream after real data has already reached the browser.
- Assuming a generic reverse proxy streams correctly without measuring it. It is exactly the kind of thing that looks fine until a slow, long-lived response exposes it.
- Judging a fix by whether the happy path eventually works, instead of by whether the actual reported symptom (a page that looked stuck) is now explained and addressed.

## Interview questions

1. Why does the grounding rule belong in the system instruction, not the user prompt?
2. A retrieval score cutoff cannot separate answerable from unanswerable questions. What is a better signal, and what does it still not solve?
3. What does streaming cost in code that a plain request-response call does not?
4. How would you diagnose whether a proxy is silently killing a long-lived streaming connection, rather than assume it either works or does not?
5. Why track token counts and latency before tracking dollar cost?

## Try it

1. Ask the same question through `POST /ask` (curl or the search-style script) and through the Ask page. Compare `usage.retrievalMs` and `usage.generationMs` between the two. They should be close: it is the same `RagService` code underneath.
2. Temporarily lower `CONTEXT_TOKEN_BUDGET` in `apps/api/src/rag/prompt.ts` to something small, like 200, and ask a question with several relevant documents uploaded. Watch how many sources come back, and check the prompt actually sent (log it, or read the test in `rag.e2e.spec.ts` that proves the same thing without a live call). Revert the change after.
3. Ask a question that is close to what the documents cover but not quite answered by them, for example about a topic only named in passing. If retrieval still finds chunks (it usually will; embedding similarity rarely returns nothing), the response's `sources` still lists them with their real scores, even though `noAnswer` is true, because those chunks were shown to the model, it just decided not to use them. Compare those scores with an answerable question's. Do they look clearly lower, or about the same?
