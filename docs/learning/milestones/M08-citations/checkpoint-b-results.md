# Checkpoint B results (2026-09-26)

Citations, end to end: the backend (structured output on the plain endpoint, marker parsing on the streaming one, shared verification) and the frontend (citation chips, the source panel, the highlight). Everything below is built and tested. What is still open is your part: the visual browser check, in "Your part" below.

## What was built

```
Non-streaming (POST /ask):
  passages (numbered) + question
       -> Gemini generate() with responseSchema forcing { answer, citations: [{marker, sourceIndex}] }
       -> parseStructuredAnswer(): reads the JSON reply, or returns null on anything malformed
       -> verifyCitations(): checks each sourceIndex against the passages really sent
       -> { answer, citations: [{marker, sourceIndex, verified}], sources (now with passage text), usage }

Streaming (GET /ask/stream):
  same passages, system prompt instructs inline [N] markers
       -> prose streamed exactly as Milestone 7 built it
       -> once the stream ends, parseInlineMarkers() reads [N] out of the completed text (marker = sourceIndex, by convention)
       -> verifyCitations(): the same check, shared with the plain endpoint
       -> the same { answer, citations, sources, usage } shape, in the "done" event
```

| Piece | Where |
|---|---|
| The `[N]` marker instruction, the citation schema, parsing and verification | `apps/api/src/rag/prompt.ts` |
| `RagService.answer()` (schema) and `answerStream()` (markers), both feeding the one shared verifier | `apps/api/src/rag/rag.service.ts` |
| `AnswerSource.text` (the source panel needs the real passage, not just its name and page) | `apps/api/src/rag/rag.service.ts` |
| The provider-agnostic `JsonSchema` type and its translation to Gemini's `Schema` | `apps/api/src/llm/types.ts`, `apps/api/src/llm/gemini/gemini-llm-client.ts` |
| Citation chips, the source panel (a `Sheet`), the `bg-cite` highlight | `apps/web/src/components/ask-view.tsx` |
| The `Citation` type and `AnswerSource.text` mirrored for the frontend | `apps/web/src/lib/types.ts` |

## The design in practice

- **Two different techniques, on purpose, not one compromise.** The plain endpoint uses a real `responseSchema`: Gemini is constrained to return `{ answer, citations }` as actual JSON, so the marker-to-passage mapping is declared by the model, not assumed. The streaming endpoint cannot do this (JSON is not valid until the whole object arrives), so it keeps Milestone 7's flowing prose unchanged and relies on the `[N]` convention instead, parsed out with a regex once the full answer is in. Both converge on the same `citations: [{ marker, sourceIndex, verified }]` shape, so the frontend does not need to know which endpoint answered.
- **A malformed structured reply degrades, it does not throw.** `parseStructuredAnswer()` returns `null` for anything that does not match (bad JSON, a missing field, a non-numeric marker). `RagService.answer()` then falls back to the raw text as a plain, uncited answer, the same as Milestone 7's whole behavior before this milestone existed. This also kept every one of Milestone 7's original tests passing unchanged: their fake replies are plain sentences, not JSON, so they now simply produce an answer with no citations, exactly as before.
- **Verification is structural, and it is checked with a real deliberate-break round.** `verifyCitations()` only asks whether `sourceIndex` names a passage that was really included in `context.used`. A citation is kept either way: `verified: false`, never removed. Eight deliberate breaks were tried against this and the rest of the new logic (see Tests, below); all eight were caught by the test suite.
- **The source panel and the highlight follow `FRONTEND_RULES.md`, not a new design.** Citation chips reuse the `primary` token (verified) or `warning` token (unverified), never a new color. The source panel is a `Sheet` (already used elsewhere in the app for the mobile nav), opening from either a citation chip or the plain sources list, always showing the whole cited passage with `bg-cite`, per the Checkpoint A decision to highlight the whole chunk rather than one matched sentence.
- **An unverified citation is a distinct sheet, not a red error.** It explains plainly that the citation could not be matched to a passage that was actually searched, using the `warning` token and a `TriangleAlert` icon, consistent with how Milestone 7 already treats "I don't know" as a correct outcome, not a failure.

## Live checks, with real Gemini and Alice's real Acme Corp demo documents

Both worked on the first try today, no demand spike this time (Checkpoint B6 of Milestone 7 could not get this far, so this is the first time either endpoint's citation behavior has been seen against a real model, not the fake test client):

**The plain endpoint**, "How much money can I claim for setting up my desk at home?":
```
answer: "Remote employees receive a one-time home office allowance of 400 dollars [1]."
citations: [{ "marker": 1, "sourceIndex": 1, "verified": true }]
```
Gemini's structured reply correctly named the one real passage it used. generationMs 1644.

**The streaming endpoint**, the same question: the prose streamed exactly as Milestone 7 built it ("Remote employees" then " receive a one-time home office allowance of 400 dollars [1]."), and the `done` event's `citations` came back identical in shape: `[{ "marker": 1, "sourceIndex": 1, "verified": true }]`. Real Gemini followed the `[N]` prompt convention correctly with no schema forcing it to.

**An unanswerable question**, "What is the policy on pets in the office?": the fixed refusal phrase, `noAnswer: true`, `citations: []`. Unchanged from Milestone 7, confirmed still correct with the new code path in front of it.

**What was not observed live: an unverified citation.** The real model, asked twice, cited correctly both times: it did not invent a passage number. This is a good sign about the model's real behavior, but it means the "unverified" branch is proven by the automated tests (the e2e test that gives the fake client a citation pointing at a passage that was never sent, and checks it comes back `verified: false`, kept, not dropped) and by reading the code, not by watching a real Gemini reply misbehave. Stated plainly rather than manufacturing a fake "real" failure to show one.

## Tests

**19 new tests**, all passing: 13 unit tests in `rag-prompt.spec.ts` (`parseStructuredAnswer`, `parseInlineMarkers`, `verifyCitations`, and a constant check that the system prompt teaches the `[N]` convention), 6 new end-to-end tests in `rag.e2e.spec.ts` against the real Postgres and Qdrant with the fake LLM (a source now carries its passage text; the plain endpoint really requests `responseSchema`; a structured reply's citations come back verified or not, correctly; a non-JSON reply falls back to a plain answer; the streaming endpoint does not request a schema; streamed `[N]` markers, including a repeated one and an invented one, parse into the right shape). 352 API tests pass in total (333 before this checkpoint).

**8 deliberate breaks tried on the new logic, all caught**, one only after a real fix: an off-by-one and a missing lower bound in `verifyCitations`, dedup removed from `parseInlineMarkers`, the type check removed from `parseStructuredAnswer`, the `[N]` instruction removed from the system prompt, `answer()` no longer requesting `responseSchema`, `answerStream()` never parsing citations, and `notFound()` missing its `citations` field. That last one was missed on the first pass: nothing asserted that the zero-hits response actually carries `citations: []`, the same shape of gap Milestone 7 found once before (a real behavior worth having, with no test proving it). Fixed by adding the assertion to both the plain and streamed not-found tests, then reconfirmed caught.

The web app has no automated test suite (same as every milestone so far): `bun run --cwd apps/web build` and `lint` both pass, `check:contrast` still passes (no new color tokens, only existing `primary`, `warning` and `cite` tokens reused at different opacities, the same pattern the `destructive` badge variant already uses).

## Known gaps, on purpose

- No visual browser check yet: your part, below.
- An unverified citation's real look has not been seen live (see above): the fake-client test and reading the code stand behind it instead.
- Still true from Milestone 7 and unchanged here: no conversation history, no deep faithfulness check (Milestone 10's "citation correctness"), no dollar cost.
- The open question from Checkpoint A (a non-refusal answer with zero citation markers) was not specifically tested live or synthetically: the code path exists (an empty `citations` array renders as plain text, same as before this milestone), but no case exercised it on purpose.

## Your part: the browser check

Everything below needs your own browser, where `localhost` works normally (the assistant's browser automation tool cannot reach it in this environment, the same limitation noted in Milestone 7):

1. `bun run infra:up`, `bun run api`, `bun run web` if not already running.
2. Sign in as `alice@acme.test` (password `demo-password-123`), open **Ask**.
3. Ask "How much money can I claim for setting up my desk at home?" You should see the answer with a small numbered chip after the sentence it supports. Click it: a panel opens on the right showing the document name, page, and the passage highlighted in yellow.
4. Ask "What is the policy on pets in the office?" Plain refusal text, no chips, same as Milestone 7.
5. Open **Details** and click a source in the plain "Sources" list (not a chip): the same panel opens, without a citation number in its title.
6. Resize to about 390px wide, try both light and dark mode.
7. Tab through the page with the keyboard only: reaching a citation chip and opening it, then closing the panel with Escape, should both work with a visible focus ring.

Tell me what you see, especially anything that does not match the description above.

## Questions for you

1. Please do the browser check above and tell me what you find.
2. The open question from Checkpoint A (an uncited, non-refusal answer) still has no firm resolution. Anything you want changed there, or is "show it plainly, revisit if Milestone 10's numbers say it happens often" still fine?
