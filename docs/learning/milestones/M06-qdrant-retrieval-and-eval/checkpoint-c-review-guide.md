# Checkpoint C: reviewing the questions (your part, about an hour)

> **Update, 2026-09-21:** you asked me to choose keep or drop myself, and I did. I kept 22 (18 answerable, 4 unanswerable) and dropped 10, judging only whether a real employee could ask the question. I dropped the plainest duplicates of a topic (for example the second holiday-notice question, the second maternity-style detail question) so each guide keeps two to four questions, and I dropped one unanswerable question (q31, Universal Credit) to keep four. I did this before any search results existed. **No human reworded or reviewed the questions.** That is a real limit: the wording stays close to the guides, so the scores will lean high, and any number from this set must be described as "22 questions chosen by the assistant". You can still change any `status` or wording in the file later; a new question file hash makes a new, separate baseline.

The harness is built and tested. What it needs now is a set of questions you trust. This page explains what to do and why. The file you edit is `eval/questions/govuk.json`.

## Why your review matters

The score we compute is only as honest as the questions behind it. I drafted 32 questions after reading all seven guides. That has two weaknesses:

1. **They lean toward what I noticed.** A real employee asks about things I might not have picked.
2. **A language model that has read the text tends to reuse the text's own words.** Search does well when the question shares words with the answer, so a set written this way flatters the search. Real people say "doctor's note", the guide says "fit note".

You fix both by keeping only questions a real employee could ask, rewording any that sound like the guide, and checking that each expected quote really answers the question.

## The one rule that matters most

**Decide whether to keep a question without asking how search does on it.**

If you keep the questions search handles well and drop the ones it fails, the score goes up and means nothing. This is the same mistake as choosing test cases after seeing the results. I have not run search on your questions yet, so you cannot be tempted. If you try a question with the `search` script while reviewing, do not let the result decide whether you keep it.

## What is in the file

| Field | Meaning |
|---|---|
| `id` | q01 to q32. Keep them, they name the question in results. |
| `status` | `candidate` (not reviewed), `keep` (used in runs), `drop` (ignored). Change this on every question. |
| `question` | The words a person would type. Reword freely. |
| `answerable` | `true` if the guides answer it, `false` if they do not. |
| `answers` | For answerable questions: the guide's file name and a short exact quote that answers it. Empty for unanswerable ones. |
| `kind` | What the question is meant to test. For reading the results, not used in scoring. |
| `note` | Why I added it, where that is not obvious. |

## How a question is judged

The harness searches, takes the top 5 chunks, and asks for each one: **does it come from the named guide and contain the quote?** If yes, that chunk is a hit. The rank of the first hit gives the scores.

Worked example, q22 ("How much is the weekly pay for a new dad taking time off?"):

- Expected: guide `paternity-pay-leave`, quote `The statutory weekly rate of Paternity Pay is £194.32`.
- The maternity guide also contains the number £194.32. If search returns that chunk first, it is **not a hit**, because it is the wrong guide. That is a real failure of search, and it is exactly what the score should show.
- The quote is compared with capital letters, curly quotes and line breaks ignored, so you can type a normal apostrophe.

Why quotes and not chunk ids: chunk ids change every time a document is cut again, and Checkpoint D compares three ways of cutting. A quote stays the same, so every strategy is judged by the same standard.

## What makes a good quote

- **Short and exact.** One sentence or less, about 10 to 15 words, copied from the guide. A short quote rarely falls across a chunk boundary. A quote that does is reported separately as "chunking cut through the answer".
- **It answers the question**, not just mentions the topic.
- **More than one passage can answer.** If two places in the guides answer the question, add a second entry to `answers`. Either one counts (see q06 and q21).

## Steps

1. Open `eval/questions/govuk.json`. The table below is the draft as I wrote it, so you can read it here first.
2. For each question, set `status` to `keep` or `drop`. Aim for **about 20 kept**, including **at least 4 unanswerable ones**, spread over the seven guides.
3. Reword any question that sounds like the guide. Fix any quote you think is weak.
4. Run `bun run --cwd apps/api eval:check`. It checks that every quote is really in its guide and that a single chunk can hold it. It makes no Gemini call and changes nothing.
5. Tell me "questions ready". I run the baseline and store it.

**Short version (about 10 minutes):** set `keep` or `drop` on each question and leave the wording. The set is usable, but the score will lean a little high because the wording is close to the guides.

## The 32 drafted questions (snapshot, 2026-09-21)

Unanswerable ones are marked "none". The JSON file is the truth once you start editing.

| id | Question | Answered in | What it tests |
|---|---|---|---|
| q01 | What is the minimum paid time off I'm legally allowed each year? | holiday-entitlement-rights | plain |
| q02 | I work three days a week. How many days of holiday should I get? | holiday-entitlement-rights | number inside a long guide |
| q03 | Can I ask to be paid cash instead of taking my holiday? | holiday-entitlement-rights | plain |
| q04 | I was off sick most of last year and could not use my holiday. How much can I carry over? | holiday-entitlement-rights | number inside a long guide |
| q05 | How far ahead do I have to ask before booking a week off? | holiday-entitlement-rights | plain |
| q06 | Does my holiday still build up while I'm on maternity leave? | holiday-entitlement-rights, maternity-pay-leave | several guides answer it |
| q07 | What's the most I can be paid per week if I'm too ill to work? | statutory-sick-pay | plain |
| q08 | When do I have to hand in a doctor's note? | statutory-sick-pay | plain |
| q09 | My sick pay is running out but I'm still ill. What paperwork should my employer give me? | statutory-sick-pay | asks for a document, not a number |
| q10 | What's the most hours I can be made to work in a week? | maximum-weekly-working-hours | plain |
| q11 | Is my lunch break counted as working time? | maximum-weekly-working-hours | plain |
| q12 | How much notice do I have to give to cancel an agreement to work extra hours? | maximum-weekly-working-hours | same number in several guides |
| q13 | How much redundancy pay do I get for each year of work if I'm over 41? | redundancy-your-rights | plain |
| q14 | How long do I need to have worked somewhere to get redundancy pay? | redundancy-your-rights | plain |
| q15 | Do I pay tax on my redundancy money? | redundancy-your-rights | plain |
| q16 | If I'm offered a different job instead of being made redundant, can I try it out before deciding? | redundancy-your-rights | plain |
| q17 | Do I get paid for the time I spend at job interviews while working my notice? | redundancy-your-rights | number inside a long guide |
| q18 | When do the special rules for laying off lots of people at once start to apply? | redundancy-your-rights | plain |
| q19 | How early before my due date can I start my maternity leave? | maternity-pay-leave | plain |
| q20 | I'm pregnant. How long before the due date do I have to tell my employer I want to take leave? | maternity-pay-leave | same number in several guides |
| q21 | My partner is expecting. When do I need to tell my boss the due date so I can take my time off? | paternity-pay-leave | same number in several guides |
| q22 | How much is the weekly pay for a new dad taking time off? | paternity-pay-leave | same number in several guides |
| q23 | Can a new dad split his time off into two separate weeks? | paternity-pay-leave | plain |
| q24 | How long can I take off to go to a scan with my pregnant partner? | paternity-pay-leave | detail near other similar text |
| q25 | Can I ask to work from home from my very first day at a new job? | flexible-working | plain |
| q26 | How many times a year can I ask for a change to my hours? | flexible-working | plain |
| q27 | My boss said no to my request to change my hours. Can I take them to a tribunal for that alone? | flexible-working | detail near other similar text |
| q28 | What is the current national minimum wage? | none | not in the guides |
| q29 | How much is Statutory Adoption Pay each week? | none | only named in a guide, no details |
| q30 | How much notice do I have to give my employer if I want to resign? | none | close to a topic the guides cover |
| q31 | How do I apply for Universal Credit? | none | only named in a guide, no details |
| q32 | How many days of paid leave do I get when a close family member dies? | none | only named in a guide, no details |

## What the unanswerable questions are for

They are not scored as hits or misses. For each one the harness records how strongly the closest chunk matched. Later, in Milestone 8, that decides when the system should say "I don't know". If unanswerable questions score about the same as answerable ones, a simple score threshold will not work and we will need something else. Better to know now.

## What I checked, and what I did not

- **Checked:** all 32 quotes really are in the guides they name. A test reads the guides and fails if any quote is not found.
- **Checked:** every quote is found inside a single chunk of the real corpus under the current chunking (`eval:check`), so none is cut by a chunk boundary.
- **Checked:** the harness itself: 37 new tests (14 against the real Postgres and Qdrant with fake embedding vectors) and 22 deliberate breaks, all accounted for. One live run on three throwaway questions (not in your set) proved the whole path works with real Gemini and Qdrant. That run was deleted.
- **Not done, on purpose:** I have not run these questions through real search, so I do not know how search scores on them.
