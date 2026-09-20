# Milestone 5 concepts (taught before coding)

Written 2026-09-20 so you can come back to it. Each concept follows the same steps: what it is, why this project needs it, the naive approach, the production approach, the tradeoffs.

## 1. Tokens

- **What it is:** models do not read letters or words. They read tokens, which are pieces of words. In English one token is about 4 characters, or three quarters of a word.
- **Why we need it:** every limit and cost is in tokens. That covers embedding input size, the free-tier quota, and later how much context fits into an answer prompt.
- **Our numbers:** the embedding limit you showed me is 30K tokens per minute. That is about 60 chunks of 500 tokens per minute. A document of 300 chunks takes about 5 minutes to embed on the free tier.
- **Naive:** count characters or words and hope.
- **Production:** count tokens. Exact counts need a call to the provider. An estimate (characters / 4) is free but approximate, so we check its error once on real text.
- **Tradeoff:** exact but slower and rate limited, or approximate and free.

## 2. Embeddings and dimensions

- **What it is:** a model turns text into a list of numbers. Ours, `gemini-embedding-2`, returns 768 numbers. Texts with similar meaning get similar lists, even when they share no words.
- **Why we need it:** it is how a question finds the passages that answer it without matching exact words.
- **Dimensions** are the length of the list. The model decides it. Every vector in one index must have the same length.
- **Consequence:** changing the embedding model means re-embedding everything, because vectors from different models cannot be compared. So the model name and dimension are part of the cache key and are stored in config.
- **Naive:** one embedding for a whole document.
- **Production:** one embedding per chunk, from one fixed model, with the model recorded.

## 3. Cosine similarity

- **What it is:** a score for how closely two vectors point the same way. Near 1 means very similar. Lower means less related.
- **A real number from our Milestone 1 test:** related sentences scored 0.79 and unrelated ones 0.59.
- **The lesson:** unrelated text still scores 0.59. Scores are relative. You rank by score and do not trust a fixed cutoff such as "above 0.5 is relevant". This is why retrieval needs testing with numbers (Milestone 6).
- **Tradeoff:** it is cheap to compute and works well. It says "similar", not "answers the question".

## 4. Semantic search vs keyword search

- **Keyword:** matches the words. Searching "vacation" misses a paragraph that only says "annual leave".
- **Semantic:** matches meaning, so it finds the "annual leave" paragraph. It is weaker at exact things: error codes, names, numbers, part numbers.
- **Production:** use both together (hybrid search, Milestone 11). For now we build the semantic side, because it is the new part.
- **Tradeoff:** semantic search needs embeddings, which cost quota and time. Keyword search is free but literal.

## 5. Chunking: size and overlap

- **What it is:** cutting text into pieces before embedding.
- **Why we need it:**
  - One vector for a 50-page document averages everything into a blur, so it matches nothing well.
  - The answer prompt has limited room and should only get the relevant passages.
- **Naive:** cut every N characters. It splits sentences, lists and tables in half.
- **Production:**
  - Respect structure: split on paragraphs, then sentences, and cut mid-sentence only as a last resort.
  - Size in tokens, about 400 to 500 to start.
  - Add a small overlap of 10 to 15 percent, so a sentence on a boundary appears in both neighbours.
  - Keep the page number and position, so citations work.
- **Tradeoffs:**
  - Too small: a chunk loses context ("it", "the policy above").
  - Too large: the vector gets diluted and the prompt gets expensive.
  - Overlap: costs extra storage and embedding tokens, and rescues boundary cases.
- **Nobody knows the right size in advance.** Milestone 6 runs a real experiment (fixed vs paragraph vs heading-aware) and compares hit rate and MRR. This milestone builds the machinery so the experiment is possible.

## 6. Caching and free-tier limits

- **What it is:** the same text always gives the same vector for the same model. So we store each vector under a hash of (text, model, dimensions) and never embed the same text twice.
- **Why we need it:** re-uploads, re-runs, and the M6 experiment (which re-embeds for each chunking strategy) would otherwise burn the free quota.
- **Limiter:** counts tokens per minute, not only requests, because tokens are the limit that binds. It also retries with backoff on rate-limit errors.
- **Tradeoff:** the cache uses storage (a 768-number vector is about 3 KB) and must be keyed correctly. If the key leaves out the model, a model change silently mixes incompatible vectors.

## Short glossary

| Term | Meaning |
|---|---|
| Token | A piece of a word, the unit models count |
| Embedding, vector | The list of numbers that stands for a text's meaning |
| Dimension | Length of that list (768 for our model) |
| Cosine similarity | Score for how alike two vectors are |
| Chunk | A piece of a page, sized for embedding and retrieval |
| Overlap | Text shared by neighbouring chunks |
| Content hash | A fingerprint of the text, used as a cache key |
| Top-K | The K best matches for a question (Milestone 6) |
