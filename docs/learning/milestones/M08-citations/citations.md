# Citations

## Concept

Getting an answer to name which passage it drew from, in a form a program can check, not just words a person has to trust. In this project: an inline `[N]` marker in the model's own text, where N is the passage's number, checked against what was really sent to the model before the UI treats it as real.

## Why it matters

Milestone 7's grounding rule ("only answer from what you're given") makes the model less likely to invent facts, but it gives no way to check its work. A "sources used" list at the end of the answer tells you what the model *saw*, not what any particular sentence actually *drew from*. Citations close part of that gap: the model has to point at a specific passage for a specific claim, and that pointer can be checked instead of trusted blindly.

## Mental model

Two different techniques for the same idea, because one endpoint streams and one does not:

- **Non-streaming:** ask the API to force the reply into a shape (`responseSchema`), so the model hands back `{ answer, citations: [{marker, sourceIndex}] }` as real JSON. The mapping is declared by the model, not inferred by us.
- **Streaming:** words arrive one at a time, and JSON is not valid until the whole object closes, so structured output cannot be used here. Instead, the system prompt just asks the model to write `[N]` inline in its normal prose, and once the full answer has arrived, a regex pulls every `[N]` back out.

Either way, what comes out gets checked the same way: does N name a passage that was truly included in the prompt? If yes, `verified: true`. If the model invented a number, or pointed past what was really sent, `verified: false`, but the citation is kept and shown, never silently dropped.

## What we implemented

- The `[N]` marker convention, in the shared system prompt: `apps/api/src/rag/prompt.ts` (`SYSTEM_PROMPT`).
- The structured-output schema for the non-streaming endpoint: `CITATION_RESPONSE_SCHEMA` (`prompt.ts`), a small provider-agnostic `JsonSchema` type (`apps/api/src/llm/types.ts`) translated into Gemini's own `Schema` shape (`apps/api/src/llm/gemini/gemini-llm-client.ts`).
- Parsing: `parseStructuredAnswer()` (JSON, with a safe fallback to plain text on anything malformed) and `parseInlineMarkers()` (regex, deduped) in `prompt.ts`.
- Verification: `verifyCitations()` (`prompt.ts`), the one function both endpoints call.
- Wiring: `RagService.answer()` and `answerStream()` (`apps/api/src/rag/rag.service.ts`), both producing the same `citations: [{marker, sourceIndex, verified}]` shape on `AnswerResult`.
- The UI: citation chips inside the answer text, a source panel (a `Sheet`) with the cited passage highlighted (`bg-cite`), a distinct state for an unverified citation. `apps/web/src/components/ask-view.tsx`.

## Tradeoffs

- **Structured output vs. streaming is a real fork, not a workaround.** The non-streaming path's mapping is stronger (the model declares it explicitly); the streaming path's is weaker (marker number is assumed to equal passage number, by convention, never independently confirmed). Both were built on purpose, to see the real difference, not because one was easier.
- **Verification is structural only.** It proves a citation points at something real, not that the sentence is actually true given that passage. That is a genuinely harder problem (faithfulness), assigned on purpose to Milestone 10's evaluation harness, which can afford a slower, judged check across many stored runs. Building a rough version here would have been thrown away.
- **Whole-chunk highlighting, not sentence-level.** Simple and always correct, at the cost of precision when a chunk covers more than one idea. Matching the exact supporting sentence is a real NLP problem, not attempted here.
- **A malformed structured reply degrades gracefully.** If a non-streaming reply is not valid JSON (should be rare with a real schema-enforced call, but happens with a misbehaving test double or a genuine edge case), the code falls back to the raw text as a plain, uncited answer, rather than throwing the whole response away over one bad field.

## Common mistakes

- Trusting a citation because the model wrote it confidently. A citation is a claim like any other; it needs the same "did this really happen" check as the answer itself.
- Assuming JSON-schema structured output solves streaming for free. It does not: the two are close to mutually exclusive for a live, word-by-word UI.
- Silently dropping anything that fails verification. That makes the system look more trustworthy than it is, which is the opposite of the point of citations.
- Confusing "verified" with "faithful." Verified only means the pointer is real; it says nothing about whether the passage actually supports the sentence.

## Interview questions

1. Why can't you use JSON-schema-constrained output on a streaming response the same way you would on a plain one?
2. What does "verified" mean for a citation in this project, and what does it deliberately not check?
3. If a model can already be told to answer only from given passages (Milestone 7's grounding rule), why isn't that enough, and what do citations add on top of it?
4. A citation names a real, retrieved passage that just happens not to support the sentence it's attached to. Does this system catch that? Why or why not, and which milestone is meant to?

## Try it

1. Ask a question and open its citation: check that the passage shown really is the one numbered in the prompt (you can log `buildUserPrompt`'s output, or trust the test suite's coverage of it).
2. In `apps/api/test/rag.e2e.spec.ts`, find the test that gives the fake client a citation pointing at an invented passage number, and read what `verified` comes back as. That is the only place this project has actually seen an unverified citation: the real model has not misbehaved yet.
3. Picture a chunk with three sentences, only one of which the answer used. What would sentence-level highlighting need to do that whole-chunk highlighting does not? (Hint: matching the answer's wording against the passage's wording, which may be paraphrased.)
