# Chunking: cutting text for search (Milestone 5)

## Concept

Chunking cuts a document's text into pieces (chunks) before each piece is turned into a vector. A question is later matched against chunks, so the way text is cut decides what can be found.

## Why it matters

- One vector for a 50 page document averages every topic in it, so it matches none of them well.
- The answer prompt has limited room. It should receive the few passages that matter, not a whole document.
- Citations need a place to point to. A chunk knows its document, its page and its exact position.

## Mental model

```
page text ----> chunker ----> chunk 1 | chunk 2 | chunk 3
                                  \_overlap_/
```

Two chunkers exist, on purpose:

| | `fixed` (naive) | `paragraph` (production style) |
|---|---|---|
| Rule | Cut every 2,000 characters, step back 240 | Whole paragraphs, then sentences, then words as a last resort. Next chunk starts with the last sentences of the previous one |
| Cuts words in half | Yes | Never, unless a word alone is longer than the chunk |
| Sizes | Even | 731 to 1,910 characters on our sample |
| Why it exists | Baseline to compare against in Milestone 6 | The likely better one |

Measured on `demo-files/equipment-policy.txt` (5,578 characters, twenty short paragraphs, target 500 tokens, overlap 60 tokens): both make 4 chunks. `paragraph` ends its chunks at paragraph ends ("...before booking.") and repeats 184, 208 and 197 characters of whole sentences. `fixed` ends chunks in the middle of words ("...until their host confir") and starts the next in the middle of a sentence ("rs. Every visitor must be..."). Whether that hurts retrieval is a question for Milestone 6's evaluation, not something to assume.

## The rules of the `paragraph` chunker

1. Work on one page at a time. A chunk never crosses a page, so a citation can name one page.
2. Split the page into paragraphs (blank lines), and each paragraph into sentences (`Intl.Segmenter`, built into Node).
3. Pack sentences until the next one would pass the target size.
4. If the break would cut a paragraph that fits whole, move the break back to that paragraph's start.
5. A sentence longer than the target is cut at a space. In the middle of a word only when there is no space at all.
6. Overlap: the next chunk starts with the last sentences of the previous chunk, up to the overlap size.
7. A tiny leftover at the end (under 15% of the target) joins the previous chunk.

The invariant everything depends on: `page.text.slice(startChar, endChar) === chunk.text`. A test checks it on 300 random pages.

## What we implemented, and where

| Piece | File |
|---|---|
| Chunkers | `apps/api/src/chunking/fixed.ts`, `paragraph.ts`, `index.ts`, `settings.ts` |
| Saving (replace, never append) | `apps/api/src/chunking/save-chunks.ts` |
| Table `document_chunks` | `apps/api/prisma/schema.prisma` |
| Chunking inside the reading step, in the same transaction as the pages | `apps/api/src/processing/document-processor.service.ts` |
| Endpoint and the Chunks tab | `apps/api/src/documents/documents.service.ts`, `apps/web/src/components/document-chunks-panel.tsx` |
| Cut chunks again for Ready documents | `bun run --cwd apps/api chunks:rebuild [--strategy fixed]` |
| Settings | `CHUNK_STRATEGY`, `CHUNK_TARGET_TOKENS` (500), `CHUNK_OVERLAP_TOKENS` (60) |
| Tests | `apps/api/test/chunking.spec.ts`, `chunks.e2e.spec.ts` |

## Tradeoffs

- **Small chunks** keep one idea each and match precisely, but lose context ("it", "the policy above") and multiply the number of vectors.
- **Large chunks** keep context, but the vector blurs several ideas, and the prompt fills with text that is not needed.
- **Overlap** rescues sentences that sit on a boundary. It costs extra storage and extra embedding tokens.
- **Keeping paragraphs whole** gives readable chunks of uneven size.
- **Not crossing pages** gives exact page citations, and cuts a sentence that runs over a page break.
- **Sentence detection is a heuristic.** Unusual abbreviations can be split wrongly. A table row can end up in a neighbouring chunk.

## Common mistakes

- Choosing a chunk size once and never testing it.
- Cutting by characters with no regard for sentences.
- Losing the position of a chunk, which makes citations and highlighting impossible.
- Letting a re-run add chunks instead of replacing them.
- Forgetting that changing the sizes changes every chunk, so every vector must be made again.

## Interview questions

1. Why chunk at all? What goes wrong with one vector per document?
2. What does overlap fix, and what does it cost?
3. How would you choose a chunk size for a new kind of document, and how would you prove your choice?
4. Why keep the chunk's start and end positions in the database?
5. What happens to stored vectors when you change the chunking rules?

## Try it

1. Open the Chunks tab for `equipment-policy.txt` and find a place where the overlap repeats two sentences. Would a question about those sentences find them in one chunk or two?
2. In `.env` set `CHUNK_TARGET_TOKENS=150` and `CHUNK_OVERLAP_TOKENS=20`, run `bun run --cwd apps/api chunks:rebuild`, and look again. What changed in the count and in the repeated sentences?
3. Run `bun run --cwd apps/api chunks:rebuild --strategy fixed` and open `/api/documents/<id>/chunks?strategy=fixed`. Find a chunk boundary that would give a wrong answer.
