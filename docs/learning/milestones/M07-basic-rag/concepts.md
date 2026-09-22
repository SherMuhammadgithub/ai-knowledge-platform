# Concepts for Milestone 7: basic RAG

Six concepts, taught before any code. Read this once, then the plan in `README.md`.

## 1. Context construction

- **What it is:** turning retrieved chunks into text a language model can read next to the question.
- **Why this project needs it:** the model knows nothing about your documents. Every fact it can use has to be in the prompt, every call.
- **Naive approach:** paste every retrieved chunk into the prompt, in whatever order search returned, no limit.
- **Production approach:** number the chunks, label each with its document name, and cap the total by a token budget so one long chunk cannot push the others out silently.
- **Tradeoff:** more chunks raise the chance the answer is included, and also raise cost, latency, and the chance of an irrelevant chunk distracting the model.

## 2. System vs. user instructions

- **What it is:** the API already splits a call into a fixed `systemInstruction` and the specific `prompt`. `GeminiLlmClient.generate()` (built in Milestone 1) already takes both.
- **Why it matters here:** the grounding rule ("only answer from what you're given") must hold for every question, so it belongs in the system slot, not mixed into a one-off string.
- **Naive:** one string with the question and the chunks glued together and a vague plea to be helpful.
- **Production:** a fixed system instruction (grounding rule, what to do about instructions found inside a chunk, tone), a user turn that is just numbered context plus the question.
- **Tradeoff:** a strict grounding rule cuts hallucination, and also makes the model refuse more than it needs to if worded too cautiously.

## 3. Temperature

- **What it is:** a number controlling how much randomness goes into choosing the next word. Near 0, the model sticks to the most likely wording every time. Higher values let it phrase things differently on repeated runs, further from the source.
- **Why it matters for RAG:** a grounded factual answer should track the source closely, not vary creatively.
- **Decision for this milestone:** 0.2. A brainstorming feature would want the opposite.

## 4. Streaming

- **What it is:** the server sends the answer's words as the model produces them (Server-Sent Events), instead of one response after the whole thing is done.
- **Why it matters:** a multi-sentence grounded answer can take a few seconds. Streaming shows movement immediately, which matters more for a demo than the total time.
- **Tradeoff:** more code (a streaming route, a client that reads a stream instead of one JSON value), and testing needs a different approach than asserting on one return value.
- **Plan:** the plain, fully tested, non-streaming path first. Streaming is added on top for the web UI.

## 5. Cost and latency tracking

- **What it is:** `generate()` already returns input and output token counts, and the usage sink already logs every call (Milestone 1). This milestone adds measuring retrieval time and generation time separately, and returning both with the answer.
- **Why separately:** a slow answer could be Qdrant or Gemini. You need to know which, to know what to fix.
- **Scope decision:** translating tokens into a dollar figure is not meaningful on the free tier, and pricing is a fast-moving fact. Persisted cost tracking belongs to Milestone 13 (production usage and cost tracking). This milestone returns token counts and timings only.

## 6. "I don't know" handling

- **What it is:** the model says plainly that the documents do not answer the question, instead of guessing.
- **Why a score cutoff does not work:** Milestone 6 measured it. The closest chunk's score for answerable questions (0.665 to 0.798) overlapped with unanswerable ones (0.627 to 0.717). No cutoff separates them cleanly.
- **This milestone's approach:** stop deciding from the score. Always retrieve and always pass chunks to the model, and let the system instruction decide by grounding: answer only from the given text, and say a fixed phrase if it is not there. The response is checked for that phrase, so the API can also return a plain `noAnswer` flag.
- **One shortcut:** if retrieval returns zero chunks (empty workspace), skip the LLM call and return the "not found" answer directly. No point paying for a call whose answer is already known.
- **What this is not:** verified, structured citations. Milestone 8 adds JSON schema output and checks that each claim is backed by the passage it names. This milestone's phrase convention is good enough to test and demo, and gets replaced properly next milestone.

## Short glossary

| Term | Meaning |
|---|---|
| Grounding | Answering only from the given text, not from the model's own trained knowledge |
| Hallucination | A confident answer that is not supported by the given text |
| System instruction | The fixed part of a call: rules for behaviour, sent once, separate from the user's request |
| Temperature | How much randomness goes into choosing each next word |
| SSE (Server-Sent Events) | A one-way stream from server to browser over plain HTTP, used to push words as they are generated |
| Context window | How much text (question, system instruction, retrieved chunks) fits in one call to the model |
| Refusal | The model's answer when it decides the given text does not answer the question |
