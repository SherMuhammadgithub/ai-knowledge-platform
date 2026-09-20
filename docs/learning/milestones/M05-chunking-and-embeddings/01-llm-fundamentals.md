# LLM fundamentals: tokens, budgets and limits (Milestone 5)

## Concept

A language model does not read letters or words. It reads **tokens**, which are pieces of words. In English one token is about 4 characters, or three quarters of a word. Everything a provider measures is in tokens: how much text a call may hold, how much it costs, and how much you may send per minute.

Two kinds of model appear in this project:

| Model | Job | Input | Output |
|---|---|---|---|
| Generation model (`gemini-3.5-flash-lite`) | Writes text: answers, later judgements | A prompt | Text, plus hidden "thinking" tokens |
| Embedding model (`gemini-embedding-2`) | Turns text into a vector of numbers | Text, up to 8,192 tokens | 768 numbers per text |

## Why it matters

- **Limits are per minute and per day, in tokens.** On the free tier the embedding limit that binds is about 30,000 tokens per minute. A document of 300 chunks of 500 tokens is 150,000 tokens, so it takes about 5 minutes at best. Design has to assume waiting.
- **Size decisions come from tokens.** Chunks are sized in tokens, and later the answer prompt has a token budget for the retrieved passages.
- **Estimates hide risk.** Counting tokens exactly needs a provider call, so most code estimates. An estimate that is wrong in the unlucky direction breaks a rate limit.

## Mental model

```
text --tokenizer--> tokens --model--> result
        (the provider counts these: limits, cost)
```

Our two estimates, and why they differ:

| Use | Rule | Why |
|---|---|---|
| Sizing chunks | characters / 4 | Slightly high for English prose, so chunks come out a bit smaller than planned. Harmless. |
| Rate limiter | characters / 3 | More cautious. If we guess too few tokens we send too much and get refused, and refusals cost more than waiting. |

Measured in Checkpoint A against real counts (`bun run --cwd apps/api lab:embeddings`):

| Text | Estimate error (characters / 4) |
|---|---|
| English prose | 1% to 19% too high |
| Codes and numbers | 72% too low |
| SQL | 19% too low |
| Urdu sentence | 32% too low |

Even `characters / 3` does not cover code and numbers fully (93 characters were 82 tokens, so 31 estimated). The retry with backoff is the real safety net. The limiter only makes hitting it rarer.

## What we implemented, and where

| Piece | File |
|---|---|
| Token estimate for chunk sizes | `apps/api/src/chunking/settings.ts` (`estimateTokens`) |
| Token estimate for the limiter | `apps/api/src/llm/tokens.ts` (`estimateTokensForLimiter`) |
| Tokens-per-minute limiter (sliding 60 second window) | `apps/api/src/llm/resilience.ts` (`TokenLimiter`) |
| Provider calls split by token budget, budget spent on every attempt | `apps/api/src/llm/gemini/gemini-embedding-client.ts` |
| Setting | `GEMINI_EMBEDDING_TPM` in `.env` |
| The measuring experiment | `apps/api/src/scripts/embedding-lab.ts` |

## Tradeoffs

- **Exact vs estimated counts:** exact is slower and rate limited itself. Estimated is free and wrong sometimes.
- **Cautious limiter vs speed:** a stricter guess makes English text about a third slower to embed, and avoids refusals.
- **In-process limiter:** two worker processes would each think they have the full budget. Sharing it through Redis is planned for Milestone 13.
- **Budget spent on retries:** a retry is a real call, so it uses budget too. Forgetting this makes a retry storm.

## Common mistakes

- Counting words or characters and treating that as tokens.
- Setting the limiter to the exact provider limit with an estimate that can be low.
- Only limiting requests per minute when the binding limit is tokens per minute.
- Not spending budget for retries.
- Sending a request bigger than the whole budget and waiting forever (our limiter lets an oversized request through once the window is empty).

## Interview questions

1. What is a token, and why are provider limits and prices in tokens?
2. Why can requests per minute be fine while tokens per minute is exceeded?
3. How would you rate limit calls to a provider that does not tell you how many tokens a call used?
4. Why does a retry have to spend rate-limit budget?
5. Text in another language, or code, can have far more tokens per character than English. What breaks if you ignore that?

## Try it

1. Run `bun run --cwd apps/api lab:embeddings` and read part 2. Add a sentence in a language or format you work with and see how far off `characters / 4` is.
2. Set `GEMINI_EMBEDDING_TPM=3000` in `.env`, restart the worker, upload `demo-files/equipment-policy.txt`, and watch the Indexing progress line move slowly. What is the slowest part?
