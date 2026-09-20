# Checkpoint A results (2026-09-20)

Produced by `bun run lab:embeddings` (`apps/api/src/scripts/embedding-lab.ts`), real calls to `gemini-embedding-2`, 768 dimensions. Run it again any time to check the numbers.

## What the docs say (A1)

Read on 2026-09-20 from the Gemini embeddings page (summarised by a fetch tool, so the parts we did not test ourselves are second hand). Also recorded in `docs/PLAN.md`.

| Fact | Value |
|---|---|
| Model id | `gemini-embedding-2` |
| Input limit | 8,192 tokens per text (the older `gemini-embedding-001` had 2,048) |
| Dimensions | default 3072, allowed 128 to 3072, recommended 768, 1536, 3072. We use 768 |
| Normalisation | done by the model for sizes below 3072. We checked: our vectors have length 1.0000 |
| Query vs document | no `task_type` parameter. The text carries the instruction (`task: search result \| query: ...`). Our client already does this through its `purpose` argument |
| Several texts in one call | must be separate content entries, otherwise you get one merged vector (we found this in Milestone 1) |
| Token counting | `countTokens` works with `gemini-embedding-2` |

## Meaning search (A2)

An embedding is 768 numbers, for example `[0.0064, 0.0279, 0.0189, ...]`. Its length is exactly 1.0. Because of that, cosine similarity equals the plain dot product, which is why fast vector search can be simple.

| Question | Rank 1 | Rank 2 | Rank 3 |
|---|---|---|---|
| "How many vacation days do I get?" | **0.7928** "25 days of annual leave" | 0.6725 "Vacation photos must not be posted..." | 0.5900 "The office kitchen has a coffee machine" |
| "What does error ERR-4021 mean?" | **0.8261** "ERR-4021: the payment gateway timed out" | 0.7283 "Error codes that start with 4..." | 0.5837 "Our refund policy allows..." |
| "Can I work from home on Fridays?" | **0.7659** "Remote work is allowed up to three days a week" | 0.7010 "Fridays the office closes at 16:00" | 0.6238 "Expense reports are due by the fifth..." |

What this shows:

1. **Your exercise answer, measured:** pair A (0.7928) beats pair B (0.6725). Meaning won over the shared word "vacation". But B still scored well above the unrelated coffee machine (0.5900), so shared words do add score.
2. **Every score sits between 0.58 and 0.83.** The unrelated sentence still gets about 0.6. So a fixed cutoff like "above 0.5 is relevant" would accept everything. We rank, and Milestone 6 measures where to cut.
3. **The gap between a right and a wrong answer is 0.05 to 0.12.** That is small. Retrieval quality depends on many chunks being compared fairly, which is why chunking and evaluation matter.
4. **Case 3 shows a trap:** "Fridays the office closes at 16:00" ranks second for a work-from-home question only because of the word "Fridays". A reranker (Milestone 11) exists to fix this kind of near miss.
5. **Case 2 does not prove that embeddings are weak on exact codes.** The code ERR-4021 was in both the question and sentence D, and D won clearly. This is one example, not a test. Keyword search still matters for codes, and we will measure it in Milestone 11.

## Token estimate (A3)

Real counts from `countTokens` on `gemini-embedding-2`, against `characters / 4`:

| Text | Characters | Estimate | Real | Estimate error |
|---|---|---|---|---|
| Employee handbook (sample) | 644 | 161 | 159 | +1% |
| Remote work guidelines (sample) | 426 | 107 | 90 | +19% |
| Expense policy (sample) | 407 | 102 | 86 | +19% |
| Security handbook (sample) | 381 | 95 | 80 | +19% |
| Invented policy page | 1175 | 294 | 252 | +17% |
| Codes and numbers | 93 | 23 | 82 | **-72%** |
| SQL code | 119 | 30 | 37 | -19% |
| Urdu sentence | 58 | 15 | 22 | -32% |

Error is (estimate - real) / real.

What this shows:

1. **For English prose, `characters / 4` is too high by up to about 19%.** Real text averages about 4.3 to 4.8 characters per token. A chunk we call 500 tokens is really about 420. That is safe (chunks are a bit smaller than planned), and it makes the per-minute limiter cautious.
2. **For codes and numbers it is far too low.** 93 characters held 82 tokens. A page of tables, part numbers or logs could have three times the tokens we estimate.
3. **Other languages are also under-counted.** Not a target for this project, but good to know.
4. **Nothing breaks either way for chunk size.** Our limit is 8,192 tokens and chunks are about 500, so even a 4 times underestimate fits. It does matter for the token-per-minute limiter (30K per minute), which could be exceeded by structured text.

Small samples, on purpose. These are a sanity check, not an evaluation.

## A mistake worth remembering

The first run of the token check selected pages from any document in the dev database. That included resume files uploaded by hand, and their text went to Gemini's free tier for counting. It should have used only sample data. The script now selects only documents whose name contains "(sample)" plus invented text, and a rule in `CLAUDE.md` says what may be sent to a provider.

## Decisions for you at this checkpoint

1. **Token estimate:** keep `characters / 4` for sizing chunks (safe for prose), and use a stricter guess of `characters / 3` for the rate limiter so structured text cannot push us over the limit? My recommendation: yes.
2. **Query and document prefix:** keep the current wording from the client, and test it in Milestone 6's evaluation as one of the experiments.
3. **Go to Checkpoint B** (chunker and chunk table)?
