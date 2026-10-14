# Milestone 8: Citations

**Status:** done, 2026-09-26. Both checkpoints built, tested, live-checked with real Gemini, and confirmed in your own browser. Quiz open (never blocks anything). Next: Milestone 9 (conversational RAG).
**Time budget:** about 8 hours (from `docs/PLAN.md`).

## Goal

Replace Milestone 7's flat "sources used" list with claim-level citations: numbered markers inside the answer, each one pointing at a specific retrieved passage, checked for structural validity (not invented, really in context) before the UI trusts it. No conversation history yet (Milestone 9), no deep faithfulness judging yet (Milestone 10, "citation correctness").

```
Non-streaming (POST /ask):
  context passages (numbered, same as Milestone 7) + question
       -> Gemini generate() with responseSchema forcing { answer, citations: [{marker, sourceIndex}] }
       -> verify each citation's sourceIndex against the passages actually used
       -> { answer, citations: [{marker, sourceIndex, verified}], sources, usage }

Streaming (GET /ask/stream):
  same context passages, system prompt instructs inline [N] markers matching passage numbers
       -> prose streamed exactly like Milestone 7
       -> once the stream ends, parse [N] markers out of the full text
       -> verify each one the same way
       -> same { answer, citations, sources, usage } shape in the "done" event
```

## Read first

1. [`concepts.md`](concepts.md): six concepts taught before any code (structured output, the streaming/structured-output tension, verification scope, claim-level citations, the highlight decision, showing unverified citations rather than hiding them).
2. `apps/api/src/rag/prompt.ts`, `rag.service.ts`, `rag.controller.ts`: Milestone 7's code this milestone extends, not replaces.
3. `docs/FRONTEND_RULES.md` sections on citations (already written, this milestone builds to match it, not the reverse).
4. [`checkpoint-b-results.md`](checkpoint-b-results.md): what was built, the live checks (both real and honestly-not-observed), the tests, and your part.

## Plan

Two checkpoints. I stop at each one, show you the result, and wait.

**Checkpoint A: design (this document, no code)**
- [x] A1. You confirmed the decisions below with "go".

**Checkpoint B: citations end to end (backend, then the frontend source panel)**
- [x] B1. Citation schema and prompt changes: the system instruction gains the `[N]` marker convention (`N` = the same numbering `buildContext()` already assigns); `responseSchema` defined for the plain endpoint.
- [x] B2. `RagService`: the plain path calls `generate()` with the schema and parses the structured reply; the streaming path parses `[N]` markers out of the completed text with a regex. Both produce the same `citations: [{ marker, sourceIndex, verified }]` array, run through one shared verification function.
- [x] B3. Verification: a citation is `verified: true` only if `sourceIndex` refers to a chunk that was actually included in `context.used` (the same list `sources` is already built from). Anything else is `verified: false`, kept, not dropped.
- [x] B4. Tests: unit tests for the marker parser and the verifier (invented index, out-of-range index, duplicate markers, no markers at all), e2e tests for both endpoints proving `citations` comes back correctly shaped and that an invented citation is marked unverified, not silently removed or silently trusted. Deliberate-break testing on the new logic, same as every milestone so far: see `checkpoint-b-results.md`.
- [x] B5. Frontend: citation chips inside the answer text, a source panel that opens on click, the highlight on the cited chunk (`bg-cite`), the distinct visual state for an unverified citation (`warning` token, not `destructive`, since an unverified citation is a gap to flag, not a failure to alarm about). Follows `FRONTEND_RULES.md` throughout.
- [x] B6. Live check with real Gemini: both endpoints produced a correctly verified citation on the first try. An unverified citation was not observed live (the real model did not misbehave); it is proven by a fake-client test instead, documented honestly in `checkpoint-b-results.md`.
- [x] B7. You checked it live in your own browser (2026-09-26) and confirmed it works.

## Decisions (change any of these at Checkpoint A)

| Decision | Choice | Why | Cost |
|---|---|---|---|
| Citation granularity | Claim-level, inline `[N]` markers reusing the exact numbering `buildContext()` already assigns to passages | `FRONTEND_RULES.md` already commits to numbered citation chips; reusing Milestone 7's numbering avoids a second scheme | The model has to place markers correctly inside its own prose, more fragile than free prose alone |
| Non-streaming endpoint | Real `responseSchema` structured output: `{ answer, citations: [{ marker, sourceIndex }] }` | This is the concept `docs/PLAN.md` names for this milestone, and it fits cleanly where nothing needs to stream | Only usable where the full reply can be waited for |
| Streaming endpoint | Keep flowing prose exactly as Milestone 7 built it; the system prompt instructs `[N]` markers; markers are parsed out with a regex once the stream ends | JSON cannot be safely parsed while it's still arriving mid-stream. This keeps the SSE/Ask-page code from Milestone 7 unchanged | The marker-to-source mapping here relies on prompt convention (the model using real passage numbers), not a schema guarantee, so it is the weaker of the two paths |
| Output shape | Both endpoints normalize to the same `citations: [{ marker, sourceIndex, verified }]` array, alongside the existing `sources` list | The frontend renders one way regardless of which endpoint answered | Two different code paths (schema-based vs. regex-based) have to be kept converging on one shape |
| Verification scope | Structural only: does `sourceIndex` refer to a chunk really included in context. No semantic/faithfulness check | Milestone 10 owns "citation correctness" as a measured evaluation metric with a proper LLM-judge harness. A rough version here would be replaced, not reused | A citation can point at a real, retrieved passage that doesn't actually support the sentence, and still be marked "verified." That gap closes at Milestone 10 |
| Unverified citations | Shown, never dropped, marked with the `warning` token, not `destructive` | `FRONTEND_RULES.md` already rules against silently dropping or silently trusting a bad citation | One more UI state to build and test |
| Highlight granularity | Highlight the whole cited chunk in the source panel, not the one matching sentence inside it | Always correct. Sentence-level matching is a real NLP problem not worth this milestone's budget | Less precise for a chunk covering more than one idea |
| Persistence | No new database table. `citations` returned on the response and the streamed `done` event, same as `sources` today, not saved anywhere | Milestone 9 (conversational RAG) is what adds the `Message` table where a turn's citations would actually get stored. Building storage before it's needed would be wasted work | No history of past citations yet, same limit Milestone 7 already has for the whole answer |
| Module changes | `apps/api/src/rag/prompt.ts` (schema, marker parser), `rag.service.ts` (verification step), `rag.controller.ts` (citations on both response shapes). No new module | Same shape as Milestone 7 | Bigger diff in the same three files |

One open question I don't have a firm recommendation on yet: if a non-refusal answer comes back with zero citation markers at all (the model just didn't cite anything), should the UI show it as a plain uncited answer (Milestone 7's behavior, still true and useful), or should that be flagged more strongly? My lean is: show it plainly, note it as a known gap, and let Milestone 10's numbers tell us later how often it actually happens, rather than guessing now. Flag if you want it handled differently.

## What you should be able to explain at the end

1. Why structured output (a schema) and streaming don't mix, and what this project did instead of picking one and ignoring the other.
2. What "verified" means in this milestone's citations, and what it deliberately does not check yet.
3. Why an unverified citation is shown, not hidden.
4. Why citations aren't persisted yet, and which milestone changes that.

## Files this milestone touched

`apps/api/src/rag/prompt.ts`, `rag.service.ts` (extended, not replaced), `apps/api/src/llm/types.ts` and `gemini/gemini-llm-client.ts` (the `JsonSchema` type and its translation to Gemini's schema), `apps/api/test/` (19 new tests), `apps/web/src/components/ask-view.tsx` (citation chips, the source panel, the highlight), `apps/web/src/lib/types.ts` (`Citation`, `AnswerSource.text`), `docs/learning/milestones/M08-citations/`.

## Your part

- ~~Confirm or change the decisions at Checkpoint A.~~ Done, confirmed with "go".
- ~~The browser check.~~ Done, 2026-09-26: confirmed working.

## After the milestone

Quiz and exercises go into `docs/learning/QUIZ.md` under "Milestone 8". The topic note will be a new file in this folder, named at close-out.
