# Checkpoint D results (2026-09-21)

The chunking experiment: the same 22 questions, the same embedding model and the same seven GOV.UK guides, with only the way the text is cut changed. Every number below comes from three stored runs, or from counts I made over them.

**The answer in one line:** cutting in the middle of sentences (`fixed`) clearly hurts. Cutting at headings (`heading`) did not beat cutting at paragraphs (`paragraph`) on this question set. **The default stays `paragraph`.**

**Read this first:** the 22 questions were chosen by the assistant and no human reworded them, so they lean toward the guides' own wording. The set is small (18 answerable questions), and one question is 5.6 percentage points. Treat everything here as a signal, not proof.

## The three runs

| | `paragraph` | `fixed` | `heading` |
|---|---|---|---|
| What it does | cuts at paragraph and sentence ends, keeps overlap | cuts every 500 tokens wherever that lands | cuts only at headings, packs whole sections up to 500 tokens |
| Chunks | 36 | 36 | 35 |
| Average tokens per chunk (smallest, largest) | 449 (155, 507) | 459 (167, 500) | 422 (104, 553) |
| **Hit rate @1** | **88.9%** (16 of 18) | **66.7%** (12 of 18) | **83.3%** (15 of 18) |
| Hit rate @3 | 100% | 100% | 100% |
| Hit rate @5 | 100% | 100% | 100% |
| **MRR@5** | **0.944** | **0.815** | **0.907** |
| Tokens retrieved per question (top 5, estimated) | 2291 | 2334 | 2184 |
| Top score when answerable (range, median) | 0.665 to 0.798, 0.755 | 0.662 to 0.791, 0.749 | 0.671 to 0.813, 0.765 |
| Top score when unanswerable (range, median) | 0.627 to 0.717, 0.659 | 0.626 to 0.708, 0.652 | 0.626 to 0.732, 0.658 |
| Quotes cut through by chunking | 0 | 0 | 0 |
| Stored run (database row) | `01a0c3c9-3783-735c-9c91-89bfbaf1bb10` | `01a0c3c9-7df3-746b-a1c3-9959f65bb7d0` | `01a0c3c9-9108-73a7-8e04-04f64452737b` |
| File in `eval/runs/` | `2026-09-21T11-45-39-paragraph-d3.json` | `2026-09-21T11-45-57-fixed-d3.json` | `2026-09-21T11-46-02-heading-d3.json` |

Two checks on the experiment itself:
- **The runs are repeatable.** The `paragraph` run made today has the same ranks and identical top scores as the baseline from Checkpoint C. A difference between strategies is not random run-to-run noise.
- **Hit rate @3 and @5 cannot separate anything.** All three are 100%, as I expected: there are only 36 chunks, and four of the seven guides have 3 or 4 of them. Only hit rate @1 and MRR carry information.

## Which questions changed

Rank of the first correct chunk (1 is best). Six questions changed rank between strategies, and q04 ranks second in all three. The other 11 answerable questions are first in every strategy.

| Question | `paragraph` | `fixed` | `heading` |
|---|---|---|---|
| q04 carry over holiday after being off sick | 2 | 2 | 2 |
| q09 paperwork when sick pay is running out | 1 | 3 | 1 |
| q11 is my lunch break working time | 1 | 2 | 1 |
| q13 redundancy pay if I'm over 41 | 1 | 2 | 1 |
| q17 paid time off for interviews in notice | 1 | 2 | 1 |
| q20 I'm pregnant, how early do I tell my employer | 1 | 3 | 2 |
| q22 weekly pay for a new dad | 2 | 1 | 3 |

## What the numbers say

**1. `fixed` is worse, and the direction is consistent.** It ranks lower than `paragraph` on 5 questions and higher on 1. Its top score is lower on 16 of 18 answerable questions. The average gap between the best correct chunk and the best wrong chunk is 0.0146, against 0.0241 for `paragraph`. This is the clearest result of the experiment, because four questions is a real difference and every measure points the same way.

A concrete case, q13: the same answer, "one and half week's pay for each full year you were 41 or older". Under `paragraph` the chunk starts at the heading "Statutory redundancy pay" and scores 0.794, first place. Under `fixed`, the chunk that holds the answer starts in the middle of a sentence about apprentices and scores 0.734, and the guide's overview chunk beats it. Cutting in the middle of sentences and topics blurs what a chunk is about.

**2. `heading` and `paragraph` are the same within noise.** 16 of 18 questions get the same rank. `heading` is one question lower at rank 1 (q20) and one rank lower on q22. Both differences are tiny margins:
- q20: `paragraph` had a tie (0.755 against 0.755) and `heading` lost to the overview chunk by 0.011.
- q22: three paternity chunks scored 0.768, 0.764 and 0.760. That is a coin flip.

On the other side, `heading` gives a higher top score than `paragraph` on 13 of 18 questions, but only by 0.0045 on average (0.7591 against 0.7546), and its average margin is 0.0256 against 0.0241. It retrieves about 5% fewer tokens (2184 against 2291). None of that is enough to call a winner, and none of it is a reason to prefer `paragraph` strongly either. The honest result is: **no measurable difference on this question set**.

**3. The overview chunk wins more often than it should, but the numbers are small.** In 11 cases across the three runs, the top result was a wrong chunk from the right guide. In 6 of those 11, the winner was the guide's first chunk (the title and overview): q22 under `paragraph`, q11, q13 and q20 under `fixed`, q20 and q22 under `heading`. If a wrong chunk were picked at random from a guide of 3 to 8 chunks, the first one would win about 1 time in 4 (my rough estimate). So 6 of 11 is more than chance, and it fits the worry from the foundation review that the first chunk matches general questions too easily. But 11 cases is too few to be sure.

**4. A correction to Checkpoint C.** There I explained q04 (rank 2) as a list cut in half across a chunk boundary, and said it was my reading, not proven. This experiment shows it was incomplete. q04 ranks second under **all three** strategies, including `heading`, where the section that holds the answer ("Workers on parental or sick leave") is never cut. The real pattern: the answer is one section inside a chunk that also holds three other sections, and the neighbouring chunk, "If a worker was unable to take leave: workers can carry over their whole leave entitlement", is about a very close topic. A smaller chunk size would probably help this case. I have not tested that.

## Decision

**Default chunking strategy: `paragraph`.** No change to `.env` or the code default.

Why:
- It has the best rank-1 score and MRR in this experiment, even if only by one question over `heading`.
- It needs no guess about headings. `heading` falls back to the paragraph chunker on pages with no detectable headings, so it can never be better there.
- It keeps overlap between chunks. `heading` has none between sections.

What I am not throwing away: the `heading` strategy stays in the code and can be selected with `CHUNK_STRATEGY=heading`. Its `heading` column will be useful for citations in Milestone 8 ("Section: Carrying over leave"), and with a larger question set it may show a difference this set cannot.

One weakness to know about: a `heading` chunk packs several sections, and its `heading` column names only the first. The chunk that holds the q04 answer is labelled "Example". For citations that label would need improving, for example by listing every heading inside the chunk.

## What was built

| Piece | Where |
|---|---|
| Heading detection and the heading-aware chunker | `apps/api/src/chunking/headings.ts` |
| `heading` column on chunks (only the `heading` strategy fills it) | `apps/api/prisma/schema.prisma`, migration `chunk_heading` |
| Strategy `heading` registered everywhere (`CHUNK_STRATEGY`, chunk saving) | `chunking/index.ts`, `chunking/settings.ts`, `chunking/save-chunks.ts`, `config/env.ts` |
| Offline lab: which lines are headings, and how each strategy cuts a file | `bun run --cwd apps/api chunks:lab <file> [--show heading]` |
| Prepare a strategy for the GOV.UK workspace: cut, embed, put in Qdrant | `bun run --cwd apps/api eval:prepare --strategy <name>` |
| Tokens retrieved per question in every run | `evaluation/metrics.ts`, `evaluation/runner.ts` |
| Compare stored runs side by side, refusing runs that are not comparable | `bun run --cwd apps/api eval:compare <run file> <run file> ...`, `evaluation/compare.ts` |

How heading detection works: a block of text counts as a heading if it is one short line (80 characters and 12 words at most) that starts with a capital letter or a digit and does not end like a sentence, and is not a table row, a web address, an e-mail address or a "Label: value" line. I read the detected list for all seven guides and found no false headings (for example flexible working 24, holiday 33, sick pay 13, working hours 12). A test reads the guides and checks that known headings are found and that no detected heading looks like a sentence, a link or a label.

## Tests

- **312 API tests pass** (258 before): 40 for headings, 3 against the real Postgres and Qdrant (the strategies live side by side, a search returns only the strategy it asked for, the harness works on the new strategy), 10 for comparing runs, 1 for tokens.
- **30 deliberate breaks tried.** On the chunker and storage: 19 tried, 17 caught at first. One survivor showed that a rule (reject bullets) was dead code, because the final rule already rejects anything that does not start with a letter or digit, so I deleted it. The other showed a weak test (the paragraph overlap in it was smaller than one sentence, so it could not tell), which I fixed and re-checked. On the comparison and tokens: 11 tried, 9 caught, 1 gap closed (nothing checked that the database row keeps the token average), and 1 changes nothing (an unanswerable question never has a rank, so it can never differ).
- **The three scripts** (`chunks:lab`, `eval:prepare`, `eval:compare`) were checked by running them on the real data, not by unit tests.

## Costs and surprises

- **Gemini use:** 14 embedding calls for the two new strategies (33 and 36 new vectors, 2 reused from the cache) and 3 calls for the questions. Only public GOV.UK text was sent. Each preparation took 10 to 11 seconds.
- **The test vectors fooled me again.** My fake word-count embeddings are so sparse that a wrong chunk sometimes beat the right one by 0.001 to 0.005 in tests. It happened three times in this checkpoint. Each time the code was right and the test data was too weak. I picked test questions with a wide margin and wrote down why. It is the same lesson as the real experiment: a difference of 0.01 in a cosine score is small.
- **The escape-code trap struck again** in two files I had just written. I now avoid escape codes and compare character codes instead.
- **`qdrant:sync --check`** now shows "36 chunks with vector, 107 points" for the GOV.UK workspace. It is correct (36 + 35 + 36 points, one set per strategy) but it fills and compares only the configured strategy. The evaluation run itself refuses to score if Qdrant and Postgres disagree for the strategy it searches, so the experiment was safe. Making `qdrant:sync` cover every strategy is a small job for later.
- **Preparing `paragraph` again did nothing harmful.** `eval:prepare` never re-cuts chunks that exist, so the baseline's chunk ids stayed valid.

## Known gaps, on purpose

- **Chunk size was not tested.** The plan said "if time allows, three sizes for the winner". A size is not part of a strategy's identity in the database (one row per document, strategy and index), so keeping several sizes side by side needs a bigger change. I would rather do it once, in Milestone 10, with 50 questions.
- **Heading detection is proven only on plain-text guides.** Word heading styles are not read, and PDF text has not been tested with the heading strategy.
- **One small corpus of one kind of document**, questions chosen by the assistant. A different corpus could rank the strategies differently.
- **No test of how well `heading` labels serve citations.** Milestone 8.

## Questions for you

1. **Are you happy with the decision to keep `paragraph`?** If you would rather try `heading` for real use, it is one setting (`CHUNK_STRATEGY=heading` in `.env`, then a restart), but I would not, on this evidence.
2. **Go for Checkpoint E, the close-out?** It writes the topic notes (`05-retrieval.md`, `07-evaluation.md`), the Milestone 6 quiz and exercises, updates `DEMO_GUIDE.md`, `PROGRESS.md` and the milestone index. Answering the quiz is optional and never blocks anything.
