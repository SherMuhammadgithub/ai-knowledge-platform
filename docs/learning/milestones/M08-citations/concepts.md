# Concepts for Milestone 8: citations

Six concepts, taught before any code. Read this once, then the plan in `README.md`.

## 1. Structured output (JSON schema constrained generation)

- **What it is:** instead of parsing free text and hoping it has a shape you can use, you tell the model's API "your reply must match this schema," and the API forces (or rejects) anything that doesn't.
- **Why this project needs it:** Milestone 7's answer is a paragraph of prose plus a flat list of "sources used." Nothing ties a specific sentence to a specific source. A schema lets the model hand back that mapping directly instead of us guessing it from text.
- **Naive approach:** ask the model in the prompt to "cite sources like [1]" and hope it stays consistent.
- **Production approach:** Gemini's `responseSchema` (structured output) forces a shape like `{ answer, citations: [{ marker, sourceIndex }] }`. If the model can't produce that shape, the call fails clearly instead of silently returning something unparseable.
- **Tradeoff:** structured output is stricter, but it cannot be streamed token by token. Partial JSON isn't valid JSON until the whole object closes.

## 2. The streaming vs. structured-output tension

- **What it is:** Milestone 7's streaming endpoint sends prose word by word as the model writes it. A schema-forced JSON reply has no good partial state to show while it's still being generated.
- **The real choice production systems make:** either give up streaming for the structured call, or keep streaming plain text with inline markers (`[1]`, `[2]`) and work out the citation mapping after the stream ends.
- **This project's answer:** use both, on purpose, so you see the real tradeoff instead of reading about it. The non-streaming `POST /ask` gets real `responseSchema` structured output. The streaming `GET /ask/stream` keeps flowing prose with `[N]` markers, parsed out once the full answer has arrived.

## 3. Citation verification, not just citation display

- **What it is:** checking that a citation the model wrote is actually backed by something real, instead of trusting its own numbering.
- **Why it matters:** a model can invent a source number, point at a passage that was never actually given to it, or point at a real passage that doesn't actually support that sentence.
- **What's realistic to check this milestone:** structural validity. Is the cited index one of the passages that was truly included in the context sent to the model (not invented, not one the token budget dropped)? That's cheap, deterministic, and fully testable without another model call.
- **What's deliberately out of scope here:** whether the passage actually *entails* the sentence (semantic faithfulness). That needs an LLM judge or similar, and `docs/PLAN.md` already assigns exactly that job, "citation correctness," to Milestone 10's evaluation harness. Building a rough version here would be thrown away in three milestones.

## 4. Claim-level citations, not just a source list

- **What it is:** Milestone 7 already returns which chunks were used, but as one flat list at the end, unconnected to any particular sentence.
- **What changes here:** `docs/FRONTEND_RULES.md` already commits to this design: "every claim-level citation is a numbered chip that opens the source panel." The numbers the model places inline (`[1]`, `[2]`) reuse the exact same numbering `buildContext()` already builds in Milestone 7, so there's no second numbering scheme to keep in sync.

## 5. The source panel and the highlight

- **What it is:** clicking a citation chip opens a panel showing the document name, page or heading, and the passage text, with the relevant part highlighted (`bg-cite`, already a defined token).
- **The decision this milestone makes:** highlight the entire cited chunk, not just the one sentence inside it that actually matches. Matching a specific sentence within a chunk is a real natural-language problem (splitting sentences correctly, fuzzy-matching wording) that this milestone's budget doesn't cover. The whole-chunk highlight is always correct, just less precise for a chunk that covers more than one idea.

## 6. Unverified citations are shown, never hidden

- **What it is:** `FRONTEND_RULES.md` already states the rule: "if a citation cannot be verified against a stored chunk, the UI shows it as unverified. It is never silently dropped and never shown as valid."
- **Why it matters:** quietly dropping a bad citation would make the answer look more trustworthy than it actually is, which is the exact failure mode this whole milestone exists to reduce.
- **What "unverified" means here:** the structural check from concept 3 failed (invented index, or an index referring to a chunk that was not really in context). The UI marks that specific citation distinctly; it does not throw away the sentence or the answer.

## Short glossary

| Term | Meaning |
|---|---|
| Structured output | A model reply constrained to match a declared schema, instead of free text |
| Citation marker | The inline `[N]` a model places in its own prose, pointing at passage N |
| Verification (this milestone) | Checking a citation's index is real and was actually in context, not checking the claim is true |
| Faithfulness | Whether an answer's claims are actually supported by its sources. Measured properly in Milestone 10, not here |
| Source panel | The UI element that shows the full passage behind a clicked citation |
