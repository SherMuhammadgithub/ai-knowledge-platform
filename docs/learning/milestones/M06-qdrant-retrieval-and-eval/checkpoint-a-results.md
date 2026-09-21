# Checkpoint A results (2026-09-21)

## Qdrant, verified (A1)

Read from Qdrant's docs, and then **checked by a real experiment** against your running server (a throwaway collection with made-up 4-number vectors, no project data, deleted afterwards). Also recorded in `docs/PLAN.md`.

| Fact | Result |
|---|---|
| Server | v1.19.1 (Docker). Client `@qdrant/js-client-rest` 1.19.0, official (published by `qdrant-tech`, Apache-2.0), needs Node 22 or newer |
| Multi-tenancy | Docs recommend one collection, with a `keyword` payload index on the tenant field created with `is_tenant: true`, which stores each tenant's points together. Our `workspace_id` fits |
| Filtering | Happens during the search. Checked: an unfiltered search returned another workspace's point as a perfect match, and the filtered search returned only workspace A's points |
| Point ids | UUID or unsigned integer. A plain string is refused (400). Our chunk ids are UUIDs |
| Upsert of an existing id | Overwrites the vector and the payload, no duplicate. Checked: count stayed the same |
| Cosine scores | Range -1 to 1. A longer copy of the same direction scores 1 (length is ignored). The opposite direction scores -1 |
| `score_threshold` | Works (with 0.95 two of three points stayed) |
| Exact search | `params: { exact: true }` compares everything. This is how we check the approximate results |
| Delete | By ids and by filter (workspace and document) both work, other workspaces stay |
| Wrong vector size | Refused with a clear error (400) |
| Defaults | HNSW `m` 16, `ef_construct` 100, and `full_scan_threshold` 10000 |

One thing this changes: below the full scan threshold, Qdrant scans everything instead of using the approximate index. Our corpus (hundreds of chunks) will be searched exactly. So a "Qdrant matches brute force" test proves our data, filters and ids are wired correctly, and does not prove anything about the approximate index. I will say so in the results and not present it as a quality test.

`payload_m` and `m: 0` (the setting for collections with very many tenants) are not needed at our size. Not used.

## Corpus candidates (A2)

Licences read from the sources. Details in `eval/corpus/LICENSES.md`.

| Candidate | Licence | Fit |
|---|---|---|
| **A. GOV.UK employment guidance** (holiday entitlement, sick pay, notice periods, redundancy, and similar) | Open Government Licence v3.0. Attribution required. Some content is exempt, so each page is checked | Same domain as our demo (leave, pay, rules at work). Multi-page guides with clear headings and exact numbers, so it tests synonyms ("vacation" and "holiday") and exact figures |
| B. Kubernetes documentation | CC BY 4.0, attribution | Very well structured with headings and code. Technical vocabulary, so it tests exact terms more than meaning |
| C. The Rust book | MIT and Apache-2.0 | Long chapters with headings. Educational, code heavy |
| GitLab handbook | Unclear (MIT for "software", "All Rights Reserved" on the site) | Not used |
| Basecamp handbook | No licence file | Not used |

**My recommendation: A.** It matches what the product is for (questions about company and workplace rules), it has headings so heading-aware chunking can be tested, it has both exact numbers and everyday wording, and the licence is clear. The content is UK law, and we use it only as test text, not as advice. I would take about 6 guides, each a few pages: holiday entitlement, sick pay, notice periods, redundancy, maternity and paternity leave, and the minimum wage. That is roughly 30 to 40 pages of text.

The files are web pages, so I would convert each to a plain text file (and some to Word files with real heading styles) and record the changes made.

## Foundation review (A3)

What I would look at before building more on the current foundation. For each: what it is, what it costs, and my recommendation. **You decide what goes into this milestone.**

| # | Finding | Risk | Recommendation |
|---|---|---|---|
| 1 | **Headings are not kept.** Reading a file stores only plain text, so a heading-aware chunker has nothing to work with. | The planned three-way comparison cannot include a real heading-aware strategy without a change to the reading step. | **Do it in Checkpoint D.** First guess headings from patterns (numbered lines, short lines before a blank line). For Word files, read heading styles if the library exposes them. Store the heading with each chunk (a `heading` column, which the original plan already had). |
| 2 | **Two copies of every vector.** Postgres has the cache, Qdrant will have the search copy. They can disagree, for example when a document is re-chunked or deleted. | Stale points in Qdrant returning text that no longer exists. | **Make Ready mean "in Qdrant".** The Indexing step writes the points last. Deleting a document deletes its points by filter. Re-chunking deletes and rewrites. A rebuild script and a consistency check compare the two. |
| 3 | **Chunk ids change on every re-chunk.** | Old points would stay behind. Evaluation that points at chunk ids would break. | Already handled in the plan: points are keyed by chunk id and old ones are deleted, and questions are judged by quote, not chunk id. |
| 4 | **Strategies share one collection.** Fixed, paragraph and heading-aware chunks of the same document can all exist. | A search that does not filter by strategy would mix them. | Add a `strategy` field to the payload, index it, and make it part of the mandatory filter. |
| 5 | **Chunks never cross a page** (our earlier decision). | A sentence split by a page break loses context. | Keep for now. It matters for PDFs only, and the corpus will be mostly single-page text. Revisit if the failures show it. |
| 6 | **No "I don't know" signal.** Scores cannot say when the documents do not contain an answer. | The answer step would answer anyway. | Not this milestone. Milestone 7 (answer prompt) and Milestone 10 (unanswerable questions in the evaluation). |
| 7 | **The baseline is one document with 3 chunks.** Your resume test could not tell noise from weakness. | We would tune to noise. | The corpus and the question set fix this. Nothing else needed. |

## Decisions for you

1. **Corpus:** A, B, C, or another public source you prefer? (Recommended: A, GOV.UK employment guidance.)
2. **Foundation review:** agree with my recommendations for 1 to 4? In particular, do you want heading detection in this milestone (it changes the reading step)?
3. **Go for Checkpoint B** (Qdrant), which can start while I prepare the corpus files.

## Decisions (agreed 2026-09-21)

1. Corpus: **GOV.UK employment guidance**.
2. Foundation review: all recommendations accepted, including heading detection in Checkpoint D.
3. Go for Checkpoint B.

## The corpus, built and loaded

- `bun run --cwd eval build-corpus` fetches seven guides through the GOV.UK content API and converts them to plain text (headings as their own lines, bullets as "- " lines, table rows joined with " | "), with a manifest and checksums. `eval/corpus/LICENSES.md` records every source, the licence and the changes made.
- `bun run --cwd eval load-corpus` created a separate account and workspace (`eval@akp.test`, "GOV.UK corpus's workspace") and uploaded the files through the normal pipeline. Through your running worker, all seven were Ready in 12 seconds: **7 documents, 36 chunks, all embedded**. Only public text was sent to Gemini.

## A baseline look (A3)

Six everyday-wording questions with the current plain search, top 3 each. This is a look, not the evaluation.

| Question | Right guide in all top 3? | Top result | Scores (1st, 2nd, 3rd) |
|---|---|---|---|
| How many vacation days do I get each year? | Yes | holiday entitlement, chunk 1 | 0.7153, 0.7018, 0.6866 |
| How long will I be paid if I am off sick? | Yes | sick pay, chunk 1 | 0.7825, 0.7483, 0.7056 |
| What is the most hours my employer can make me work in a week? | Yes | maximum weekly hours, chunk 1 | 0.7955, 0.7438, 0.6988 |
| How much notice must I get if I am made redundant? | Yes | redundancy, chunk 1 | 0.7888, 0.7872, 0.7780 |
| Can my boss say no if I ask to work from home? | Yes | flexible working, chunk 1 | 0.6973, 0.6880, 0.6806 |
| How much time off can a new dad take? | Yes | paternity, chunk 1 | 0.7934, 0.7552, 0.7477 |

What this shows, and what it does not:

1. **The right guide is easy.** The guides are on clearly different topics, so document level accuracy says little. The question is whether the right chunk inside the guide comes first.
2. **Chunk 1 ranked first in all six.** It holds the guide's title and overview, so it may win because it is the most "on topic" and not because it contains the answer. This is a hypothesis for the evaluation to test, not a finding.
3. **Within a guide the gaps are tiny** (0.001 to 0.02 in several cases). Ordering inside one document is fragile.
4. The scores here (0.68 to 0.80) are higher than in the small sample corpus, which fits the chunks being about single topics with more shared vocabulary. Scores still cannot be compared across corpora.

## Status

- [x] A1. Qdrant docs read and every behaviour we depend on checked by experiment.
- [x] A2. Licences checked for five candidates, two excluded with reasons. Corpus chosen, built, documented in `eval/corpus/LICENSES.md` and loaded into its own workspace.
- [x] A3. Foundation review written and accepted. Baseline look done on the corpus.
