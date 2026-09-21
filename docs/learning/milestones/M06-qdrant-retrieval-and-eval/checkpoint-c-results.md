# Checkpoint C results (2026-09-21)

The evaluation harness is built, and the baseline is measured and stored. Every number below comes from one stored run.

**Read this first:** the 22 questions were drafted and chosen by the assistant (you asked it to choose keep or drop). No human wrote or reworded any of them. The wording stays close to the guides, so these scores probably lean high. Say "22 questions chosen by the assistant" wherever a number from this run is quoted.

## The baseline

| | |
|---|---|
| Stored as | database table `eval_runs`, row `01a0c330-573c-746f-813d-363f36c69d2e`, and `eval/runs/2026-09-21T08-58-40-paragraph-baseline.json` |
| What was searched | `paragraph` chunks: 36 chunks from 7 GOV.UK guides, average 449 tokens (smallest 155, largest 507), target 500, overlap 60 |
| Embeddings | `gemini-embedding-2`, 768 dimensions, setup `gemini-embedding-2\|768\|d290113f` |
| Retrieval | Qdrant, top 5, cosine, filtered by workspace, setup and strategy |
| Questions | `govuk-employment-v1`, file hash `7c9b8f6d...`, 22 run (18 answerable, 4 unanswerable), 10 dropped |

| Score | Value |
|---|---|
| Hit rate @1 | **88.9%** (16 of 18) |
| Hit rate @3 | **100%** (18 of 18) |
| Hit rate @5 | **100%** (18 of 18) |
| MRR@5 | **0.944** |
| Quotes cut through by chunking | 0 |

## What the numbers say, and how much to trust them

**1. Search found the right guide every time.** For all 18 answerable questions, the closest chunk came from a guide that holds the answer. That includes the questions built to confuse: a pregnant employee versus a new father (both guides say "15 weeks"), and "weekly pay for a new dad" (the maternity guide has the same £194.32). The two misses at rank 1 were both inside the correct guide.

**2. The hit rate @5 of 100% is weak evidence, and I would not quote it alone.** Three reasons:
- There are only 36 chunks. The top 5 is 14% of everything.
- Four of the seven guides have 3 or 4 chunks (sick pay 3, working hours 3, maternity 4, flexible working 4). Once search picks the right guide, the top 5 contains the whole guide, so a hit is guaranteed.
- The questions are close to the guides' wording.

The numbers that can still move are **hit rate @1 and MRR**, and even those are coarse: with 18 questions, one question is 5.6 percentage points.

**3. The two questions where the answer ranked second** (the only misses at rank 1):

| Question | Ranked first | Answer was in | Gap |
|---|---|---|---|
| q04 carry over holiday after being off sick | holiday guide, chunk 5 (0.754) | holiday guide, chunk 4 (0.743) | 0.011 |
| q22 weekly pay for a new dad | paternity guide, chunk 1 (0.768) | paternity guide, chunk 2 (0.755) | 0.013 |

- **q04:** the answer, "up to 20 of their 28 days", is the last bullet of chunk 4, and the next bullet starts chunk 5. A list about carrying over sick leave was cut in half. Chunk 4 mixes several topics (worked examples of how leave builds up, then the start of the carry-over section), while chunk 5 opens with the rest of the carry-over list and the next carry-over rule. So the topic is split across the boundary, and the sibling half won by 0.011. This is my reading of the chunk texts. I have not proven it.
- **q22:** chunk 1 is the title and overview of the guide ("Paternity pay and leave", with "Pay" in the list of entitlements). The exact sentence with the weekly rate is in chunk 2. Every paternity chunk talks about pay, and the first three chunks are within 0.013 of each other. This fits the worry from the foundation review that the first chunk of a document, which holds the title and overview, is a strong match for general questions. **One case is not a test of that worry.** Of the 22 top results, 9 were chunk 1, and in most of those the answer really was there. It needs more questions than this set holds.

**4. Unanswerable questions score close to answerable ones.**

| Questions | Closest-chunk score |
|---|---|
| Answerable (18) | 0.665 to 0.798, median 0.755 |
| Unanswerable (4) | 0.627 to 0.717, median 0.659 |

The ranges overlap. The highest unanswerable question (q29, "How much is Statutory Adoption Pay each week", 0.717) scores above two answerable ones (q25 at 0.665 and q17 at 0.707). This is what you would expect: a question near a topic the guides mention, but do not answer, still matches strongly. As an illustration only:

- A rule "answer only if the top score is at least 0.70" would refuse q25 (a real answerable question) and would still answer q29.
- A rule at 0.72 would refuse all four unanswerable questions, but also three answerable ones (q25, q17, q08).

With 4 unanswerable questions this shows a **direction, not a rule**. Choosing a threshold on the same questions would be tuning on the test. In Milestone 8, "I don't know" will need more than one score.

## What this means for Checkpoint D (the chunking comparison)

The baseline is close to the ceiling: only two questions can still improve, and both are one rank away. That leaves a real risk that the comparison of fixed, paragraph and heading-aware chunking will show **no measurable difference**. If that happens, the honest result is "no difference on this question set", and the default stays `paragraph`. I would not invent a winner.

How I will read it: a difference of one question is noise. I will report the numbers, but also which questions changed rank, and the score gaps, because a chunking change can move a chunk from 0.755 to 0.77 without changing a hit rate.

**An option that would make Checkpoint D more meaningful:** you write about 8 to 10 harder questions in your own words (vague wording, answers that need two chunks, questions that name no keyword from the guide). That is the one thing that would remove the largest weakness of this set. It takes about 30 minutes. It must be done before we run Checkpoint D, not after, so that no question is chosen because of how a strategy handles it. It is optional: D can go ahead without it, with the limit stated.

## What was built (recap)

| Piece | Where |
|---|---|
| Question file schema, quote matching, hit judging | `apps/api/src/evaluation/questions.ts` |
| Hit rate @1/3/5, MRR, score ranges | `apps/api/src/evaluation/metrics.ts` |
| Run, quote check, store, JSON file | `apps/api/src/evaluation/runner.ts` |
| `bun run --cwd apps/api eval:check` and `eval:run` | `apps/api/src/scripts/eval-run.ts` |
| Table `eval_runs` (tenant-owned) | `apps/api/prisma/schema.prisma`, migration `eval_runs` |
| The questions | `eval/questions/govuk.json` |

Tests: 258 pass (37 new). 22 deliberate breaks tried: 21 caught, 1 changes nothing. Details in `checkpoint-c-review-guide.md` and `docs/PROGRESS.md`.

## Costs and surprises

- **Fake vectors mislead about small differences.** One of my tests failed at first because a single rare word was drowned by chance collisions in the test's word-count vectors. The fix was in the test data, not the harness. It is a reminder that a difference of 0.01 in a cosine score is small.
- **Invisible characters.** Escape codes typed into file writes arrived as real invisible characters in four files. Fixed, and a rule added to `CLAUDE.md`.
- **The plan asked for a language model to propose questions and you to write the quotes.** I did both, and then chose keep or drop. That saved your hour and cost the set its independence.

## Known gaps, on purpose

- 18 answerable and 4 unanswerable questions: results are a signal, not proof.
- No human wrote or reworded a question.
- One corpus, one domain, 36 chunks. Search quality on a larger corpus is not measured here.
- Qdrant's approximate index is not in use at this size (0 indexed vectors), so nothing here says how good it would be at scale.
- Only retrieval is measured. Answer quality starts in Milestone 7.

## Questions for you

1. **Do you want to write the extra 8 to 10 harder questions before Checkpoint D?** Recommended if you have 30 minutes. If yes, I add them as new candidates in the same file and you set them to `keep` yourself. The baseline above stays as it is, and the new set gets a new run.
2. **Go for Checkpoint D** (heading detection, the three-way comparison)? It sends about 60 KB of public text to Gemini for embedding (36 chunks per strategy, planned around the 30K tokens per minute limit).
