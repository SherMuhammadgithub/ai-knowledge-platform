# Evaluation: measuring retrieval (Milestone 6, grows in Milestone 10)

This note is about the small evaluation built in Milestone 6: retrieval only. Milestone 10 adds answer quality (relevance, faithfulness, citations) and a 50 question set, and extends this file.

## Concept

An evaluation runs a fixed list of questions through the system, compares what came back with what should have come back, and reduces the result to a few numbers that can be stored and compared. It turns "it seems to work" into "16 of 18 questions get the right chunk first".

## Why it matters

- Every design choice in a retrieval system is a guess until measured: chunk size, chunking strategy, embedding wording, top-K, later hybrid search and reranking.
- Without stored, repeatable numbers you cannot tell an improvement from a change, and you cannot tell a regression from bad luck.
- It is also the honest part of a portfolio project: every number in the docs comes from a stored run.

## Mental model

```
question file          harness                            stored run
(question, quote,  ->  embed all questions (one call)  -> config, setup, corpus,
 document, status)     search each (top 5)                one result per question,
                       hit? at which rank?                hit rate @1/3/5, MRR
```

## The pieces

**A question file.** Each question has its text, a status (`candidate`, `keep`, `drop`), whether the documents can answer it, and for answerable ones the document and a short exact quote that answers it. A question can list several acceptable answers.

**Judging by quote, not by chunk id.** A retrieved chunk is a hit when it comes from an expected document and contains an expected quote (compared with capital letters, curly quotes and line breaks ignored). Chunk ids change every time a document is cut again, and the point of Milestone 6 was to compare different ways of cutting. A quote stays the same, so every strategy is judged by one standard. The cost is that someone has to write the quotes, and a quote that a chunk boundary cuts in half can never be found. The harness reports those separately as "cut through" (0 in our runs).

**The scores.**
- **Hit rate @k:** the share of answerable questions with a correct chunk in the top k.
- **MRR** (mean reciprocal rank): the average of 1 / rank of the first correct chunk, 0 when there is none. First place counts 1, second 0.5, third 0.33. It tells apart two searches with the same hit rate @3 where one ranks the answer first and the other third.
- **Tokens retrieved:** the average estimated size of the top 5. A strategy with bigger chunks puts more text into the same top 5, which helps a hit and costs more in the answer prompt.

**Unanswerable questions.** Some questions are meant to have no answer in the documents. They are not scored as hits or misses. The harness records how strongly the closest chunk matched anyway, because that is what a future "I don't know" rule would have to work with.

**Stored runs.** Each run is a row in the tenant table `eval_runs` and a JSON file in `eval/runs/`: the chunking settings, the chunk sizes actually stored, the embedding setup, the documents searched, the hash of the question file, and one result per question with what was retrieved. A run can be compared with another only if it used the same questions and the same embedding setup, and the comparison tool refuses anything else.

**Refusing to produce numbers that mean nothing.** The run stops, instead of warning, when a quote is not in its document, when Qdrant and Postgres disagree about how many chunks there are, or when the chunks have no vectors under the current setup. A warning gets copied away from the number it belongs to.

## What we implemented, and where

| Piece | File |
|---|---|
| Question file schema, quote matching, hit judging | `apps/api/src/evaluation/questions.ts` |
| Hit rate, MRR, tokens, score ranges | `apps/api/src/evaluation/metrics.ts` |
| Run, quote check, store, JSON file | `apps/api/src/evaluation/runner.ts` |
| Compare stored runs | `apps/api/src/evaluation/compare.ts` |
| Commands | `eval:check`, `eval:run`, `eval:prepare`, `eval:compare` (in `apps/api/package.json`, scripts in `apps/api/src/scripts/`) |
| The GOV.UK corpus and its licences | `eval/corpus/`, `eval/corpus/LICENSES.md` |
| The questions | `eval/questions/govuk.json` |
| Stored runs | `eval/runs/` and the table `eval_runs` |
| Tests | `apps/api/test/evaluation.spec.ts`, `evaluation.e2e.spec.ts`, `compare.spec.ts`, `heading-chunks.e2e.spec.ts` |

## What we found, and what it does not show

| | `paragraph` | `fixed` | `heading` |
|---|---|---|---|
| Hit rate @1 | 88.9% | 66.7% | 83.3% |
| Hit rate @3 and @5 | 100% | 100% | 100% |
| MRR | 0.944 | 0.815 | 0.907 |

Stored runs: `eval/runs/2026-09-21T11-45-39-paragraph-d3.json`, `...11-45-57-fixed-d3.json`, `...11-46-02-heading-d3.json`. Read them with `checkpoint-d-results.md`.

What it shows: `fixed` is worse than `paragraph`, in the same direction on almost every question (a lower top score on 16 of 18). `heading` did not beat `paragraph`.

What it does not show, and why:
- **A ceiling.** Hit rate @3 and @5 are 100% for everything, because the corpus has 36 chunks and four of its seven guides have 3 or 4. Only @1 and MRR carry information.
- **A small sample.** With 18 answerable questions, one question is 5.6 percentage points. `paragraph` against `heading` is one question, so it is noise.
- **Independence.** The questions were chosen by the assistant and no human reworded them, so they stay close to the guides' wording and the scores lean high.
- **Another corpus.** Seven guides of one kind of document. A different corpus could rank the strategies differently.

A run repeated on the same data gave identical ranks and scores, so the differences between strategies are not run-to-run noise.

## Tradeoffs

- **A small question set** is cheap to make and to run and gives a signal. A large one gives better evidence and costs people's time.
- **Questions written from the documents** are easy to make and reuse the documents' words, which flatters the search. Real users say "doctor's note" where the guide says "fit note".
- **Short quotes** are found more reliably and are less likely to be cut by a chunk boundary, and they can match more than one place.
- **Judging by document plus quote** is fair across strategies and can call two different passages both correct if a quote is repeated.

## Common mistakes

- **Choosing questions after seeing results.** Keeping the ones the search handles and dropping the ones it fails raises the score and means nothing. Decide first.
- **Trusting one number.** A hit rate of 100% can mean the test is too easy.
- **Reading a difference of one question as a result.**
- **Comparing runs that used different questions or a different model.**
- **Tuning a threshold or a setting on the same questions you report.**
- **Storing a number in a document that no stored run backs.**
- **Explaining one failure with a neat story and not checking it against the other runs.** Our first explanation of the q04 miss (a list cut across a boundary) was incomplete: it also missed under the strategy that never cuts a section.

## Interview questions

1. What do hit rate @k and MRR each tell you that the other does not?
2. Why define the correct answer with a quote and not a chunk id? What does that cost?
3. Your comparison shows 85% against 80% on a 20 question set. What do you say?
4. Why keep unanswerable questions in the set, and why not score them as misses?
5. How would you make a small evaluation set more trustworthy without making it much larger?
6. What is wrong with picking the test questions after you have seen how the system answers them?

## Try it

1. `bun run --cwd apps/api eval:check`, then open `eval/questions/govuk.json` and find a question with two acceptable answers.
2. `bun run --cwd apps/api eval:compare` with the three files named above. Which questions changed rank? Which of them do you find convincing, and which look like noise?
3. Write five harder questions in your own words in a copy of the question file, run them under two strategies, and compare (Exercise B in the quiz).
