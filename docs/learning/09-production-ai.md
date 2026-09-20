# Production AI (started in Milestone 1)

Running AI calls reliably on a free tier. This file grows in Milestone 4 (queues, retries, failed jobs) and Milestone 13 (rate limiting, cost tracking). What is here is what we built and measured in Milestone 1.

## Concept

An AI provider is an unreliable, rate-limited, changing dependency. Production code treats it that way: one thin interface in front of it, a limiter so you do not exceed quotas, retries with backoff for transient failures, and a record of every call (model, tokens, latency).

## Why it matters

- Free-tier quotas are small and they differ per model. A loop that ignores them fails in minutes.
- Model names, limits and behavior change. Docs pages can disagree with each other. The API list can name models you cannot call.
- Cost and latency come from tokens, and some tokens you never see (thinking tokens).

## Mental model

```
caller -> LlmClient / EmbeddingClient (interface)
            -> rate limiter (wait for a free slot)
            -> retry with backoff and jitter (only for transient errors)
            -> provider call
            -> usage record (model, tokens, latency, attempts, ok)
```

Callers never import the Gemini SDK. Swapping the provider changes `src/llm/providers.ts` and the folder `src/llm/gemini/`.

## What we implemented, and where

| Piece | File |
|---|---|
| Interfaces and the usage record | `apps/api/src/llm/types.ts` |
| Sliding-window rate limiter, retry with full-jitter exponential backoff | `apps/api/src/llm/resilience.ts` |
| Gemini generation client (thinking level, thought-token reporting) | `apps/api/src/llm/gemini/gemini-llm-client.ts` |
| Gemini embedding client (batching, dimension and count checks) | `apps/api/src/llm/gemini/gemini-embedding-client.ts` |
| Where the provider is chosen, one limiter per model | `apps/api/src/llm/providers.ts` |
| Validated settings, fail-fast at startup | `apps/api/src/config/env.ts` |
| Real end-to-end check | `bun run smoke:gemini` |

## What we measured (2026-09-19)

Free-tier limits read from AI Studio, project "Gemini Project". Re-check them before volume work.

| Model | Requests/min | Tokens/min | Requests/day |
|---|---|---|---|
| `gemini-3.5-flash-lite` (chosen for answers) | 15 | 250K | 500 |
| `gemini-3.1-flash-lite` (planned judge, Milestone 10) | 15 | 250K | 500 |
| `gemini-3.5-flash`, `3.6-flash`, `3.7-flash`, `3.8-flash` | 5 | 250K | 20 |
| Embedding row ("Gemini Embedding 1") | 100 | 30K | 1,000 |

- Quotas are per model, so the answer model and the judge model do not compete.
- Embedding is limited by tokens per minute (30K), not requests. About 60 chunks of 500 tokens a minute, so embedding a corpus takes minutes and re-embedding for each chunking experiment is costly. We need an embedding cache by content hash and a token-based limiter (Milestone 5).
- Smoke test result: a related text scored 0.79 cosine against the query, an unrelated one 0.59. Unrelated text is far from 0, so a fixed threshold cannot be guessed.

## Tradeoffs

- **Limiter in memory vs shared.** Ours is per process. When the worker is a separate process (Milestone 4) the limit has to live in Redis, or two processes together exceed the quota.
- **More retries vs faster failure.** More retries hide short outages but delay real errors and spend quota. We retry only 408, 429 and 5xx, and network failures, never 4xx client errors.
- **Interface vs provider features.** A thin interface loses provider-specific options. We expose only what the product needs (`thinking`, `purpose`), and add more when a milestone needs it.

## Common mistakes

- Trusting the model list. `gemini-2.5-flash` is listed but returns 404 for this account.
- Small `maxOutputTokens` with a thinking model. It returned HTTP 200 with an empty answer because thinking used the budget. Use minimal thinking for RAG answers, and log thought tokens.
- Sending a plain string array to `gemini-embedding-2`. It merged them into one vector. Each text must be its own `{ parts: [{ text }] }` entry. Always check that the number and size of returned vectors match what you sent.
- Choosing a model before reading its quota.
- Counting only successful calls against a limit.

## Interview questions

1. How would you protect an app from provider rate limits on a free tier? What changes when you have several worker processes?
2. Why use exponential backoff with jitter instead of a fixed delay?
3. What are thinking tokens, and how can they cause an empty response?
4. A batch of embeddings returns fewer vectors than inputs, or duplicates. How would you detect it, and where do you put that check?
5. Why record token counts and latency for every call from day one?

## Try it

Run `bun run smoke:gemini` and read the `[ai-usage]` lines. Then change `GEMINI_GENERATION_RPM` to 1, call `generate` twice in a row in the smoke script, and watch the limiter make the second call wait. With a limit of 1 per minute it can wait close to a minute, which is the point.

## See also

`background-jobs.md` covers running slow work outside the web request: queues, workers, retries, repeatable jobs and the sweeper. `text-extraction.md` covers the first step of the RAG pipeline that runs in that worker.

Milestone 5 added the tokens-per-minute limiter, token-aware batching and a cache keyed by text and embedding setup. See `milestones/M05-chunking-and-embeddings/01-llm-fundamentals.md` and `02-embeddings.md`.
