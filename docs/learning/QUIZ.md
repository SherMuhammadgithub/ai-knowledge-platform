# Quiz and exercises

Everything I have asked you so far, in one place. Answer when you like. Nothing blocks the next milestone, except that Milestone 1 question 1 is worth answering before Milestone 5 (embeddings).

How to use it:
1. Write your answer under **Your answer**. Short and in your own words is fine. A wrong answer is useful, it shows me what to teach.
2. Only then open **Answer key** (click the small triangle) and compare.
3. Tell me "check my answers" and I will review them and record the result in `docs/PROGRESS.md`.

| Part | Status |
|---|---|
| Milestone 1 quiz (5 questions) | not answered |
| Milestone 1 exercises (3) | not done |
| Milestone 2 quiz (4 questions) | not answered |
| Milestone 2 exercises (3) | not done |
| Milestone 3 quiz (6 questions) | not answered |
| Milestone 3 exercises (3) | not done |
| Milestone 4 quiz (6 questions) | not answered |
| Milestone 4 exercises (3) | not done |
| Milestone 5, before coding (2 questions) | not answered |
| Milestone 5 quiz (6 questions) | not answered |
| Milestone 5 exercises (3) | not done |
| Milestone 6, before coding (2 questions) | not answered |
| Milestone 6 quiz (7 questions) | not answered |
| Milestone 6 exercises (3) | not done |
| Milestone 7 quiz (6 questions) | not answered |
| Milestone 7 exercises (3) | not done |
| Milestone 8 quiz (6 questions) | not answered |
| Milestone 8 exercises (3) | not done |

Background reading for each part is in the other files in this folder (Milestone 5 and 6 notes are inside their milestone folders): `09-production-ai.md` (Milestone 1), `tenant-isolation.md` (Milestones 2 and 3) `file-uploads.md` (Milestone 3), and `text-extraction.md` and `background-jobs.md` (Milestone 4).

---

## Milestone 1: setup, provider layer, Gemini

### Quiz

**1. Why must the same embedding model embed both the documents and the queries?**

Your answer:

<details>
<summary>Answer key</summary>

Each embedding model learns its own vector space. A vector from model A and a vector from model B are not comparable, even if they have the same number of dimensions, so cosine similarity between them means nothing. Search works only because the query vector and the document vectors live in the same space. It also means that changing the embedding model, or its output dimension, means re-embedding every stored document.

One nuance: "same model" does not mean "identical treatment". Some models embed queries and documents differently on purpose (a query mode and a document mode) inside the same space. That is what our `'document' | 'query'` argument is for.
</details>

**2. For `gemini-embedding-2` our client writes the task into the text (`task: search result | query: ...`). For `gemini-embedding-001` it sends a `taskType` parameter. Why does our interface take `'document' | 'query'` instead of a Gemini `taskType`?**

Your answer:

<details>
<summary>Answer key</summary>

The interface should describe intent, not one provider's parameters. Callers say "this is a query" and each implementation decides how to express that for its model. Then a model change or provider change touches one folder (`apps/api/src/llm/gemini/`), not every caller.

The tradeoff: an abstraction can hide differences that matter. The exact wording of the instruction prefix affects retrieval quality, so it has to be measured (Milestone 6) and not assumed.
</details>

**3. Suppose a batch of 50 chunks came back as one merged vector, as `gemini-embedding-2` did for a plain string array. What would retrieval look like, and why might nobody notice for a while?**

Your answer:

<details>
<summary>Answer key</summary>

All 50 chunks would be stored with the same vector (or one vector for the whole batch), so they are indistinguishable to search. Queries would return arbitrary members of that batch with plausible-looking similarity scores. No error is thrown. Answers can still read fluently because the language model fills gaps, so a quick manual try looks fine.

Only a check on the count and dimension of the returned vectors, or an evaluation with known questions, exposes it. This is why the client validates both, and why we will measure retrieval instead of eyeballing it.
</details>

**4. Why does the rate limiter count retries against the quota as well?**

Your answer:

<details>
<summary>Answer key</summary>

The provider counts every HTTP request, including the ones that failed with 429 or a server error. If only successful calls were counted, a burst of retries would push us further over the limit, get more 429 responses, and cause a retry storm. Each attempt takes a slot from the limiter before it is sent. Retries also use exponential backoff with random jitter so several workers do not retry at the same instant.
</details>

**5. The hidden thinking tokens only affected `gemini-3.6-flash` through `gemini-3.8-flash` (and `3.5-flash`). Does that change which model you would pick to answer questions over documents? What mattered more when we chose?**

Your answer:

<details>
<summary>Answer key</summary>

Thinking tokens add latency and use quota, and they count against the output token cap, so a small cap can return an empty answer. For answering from retrieved context you usually want fast, predictable, cheap calls, so minimal thinking is the right default.

But the deciding factor was quota. Those models allow 20 requests per day on the free tier, too few to develop against or to run a 50-question evaluation. `gemini-3.5-flash-lite` allows 500 per day and has no thinking tokens. Lesson: read the quota table before choosing a model.
</details>

### Exercises

**A. Semantic closeness.** In `apps/api/src/scripts/smoke-gemini.ts`, embed a third text that means almost the same as the leave text but shares few words, for example "Staff are entitled to a month off each year". Print all three scores against the query. Does it beat the coffee text by a clear margin? Run it with `bun run smoke:gemini`.

Your result:

**B. Dimensions.** Run the smoke test with `EMBEDDING_DIMENSIONS=1536` in `.env` (then set it back to 768). Do the scores change? What would that mean for choosing a dimension?

Your result:

**C. A callable check.** In `apps/api/src/scripts/list-models.ts`, add a step that makes one tiny real call per generation model and prints "callable" or the HTTP status. Today's manual probe becomes a tool. Watch your daily quotas: the 20-per-day models will use one request each.

Your result:

Hints (open after trying):

<details>
<summary>Hints</summary>

A: expect a clear gap, but likely smaller than for the near-duplicate wording. Unrelated text scored 0.59 in our first run, so a raw score never means "irrelevant". That is why Milestone 6 measures thresholds instead of guessing.

B: scores move a little but the ranking should stay the same. Smaller vectors mean less memory and faster search, at a possible small quality cost that Milestone 6 can measure.

C: one request per model, roughly:

```ts
const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${id}:generateContent`, {
  method: "POST",
  headers: { "x-goog-api-key": key, "content-type": "application/json" },
  body: JSON.stringify({
    contents: [{ parts: [{ text: "Reply with the single word: ok" }] }],
    generationConfig: { maxOutputTokens: 200 },
  }),
});
```

Print `res.status` per model. Treat 404 as "listed but not available", and 429 as "callable but out of quota".
</details>

---

## Milestone 2: auth and workspaces

### Quiz

**1. The session cookie already says which workspace you are in. Why does the guard read your membership from the database on every request anyway? What breaks if it trusts the cookie?**

Your answer:

<details>
<summary>Answer key</summary>

A signed cookie only proves what was true when it was issued. If someone is removed from a workspace or their role changes, a cookie-only check keeps letting them in until it expires (7 days here). Reading the membership row each request makes removals and role changes apply on the very next request, and it means a claim in the cookie can never grant access on its own. Cost: one indexed query per request, which is fine at this scale.

Our test "a removed member loses access on their very next request" and "a forged claim is caught" cover both.
</details>

**2. Login runs a password check even when the email does not exist. What attack does that prevent?**

Your answer:

<details>
<summary>Answer key</summary>

User enumeration through timing. Hashing a password with argon2 takes noticeable time. If unknown emails returned instantly, an attacker could tell which emails have accounts by measuring response time. Verifying against a dummy hash makes both cases do the same work, and both return the same "Invalid email or password" message.

Known gap: registering with an existing email returns 409, which does reveal that the email exists. We accepted that for now and listed it in `docs/PROGRESS.md`.
</details>

**3. Why can nobody be added as OWNER through the API, and where exactly is that enforced?**

Your answer:

<details>
<summary>Answer key</summary>

A workspace has the owner who created it. If admins could grant ownership it would be a privilege escalation, and transferring ownership is a separate, deliberate feature we did not build.

It is enforced in the request schema: `addMemberSchema` in `apps/api/src/workspaces/workspaces.schemas.ts` only allows `ADMIN` or `MEMBER`, so `OWNER` gets a 400. Separately, the service only lets an owner grant `ADMIN`. The test "OWNER cannot be granted through the API" checks it.
</details>

**4. In a NestJS request, where could a developer forget the workspace filter? How will Milestone 3's workspace-scoped client change that?**

Your answer:

<details>
<summary>Answer key</summary>

Typical places: a new service query that forgets `where: { workspaceId }`; a route that fetches a document by id alone (the classic insecure direct object reference); raw SQL; a background job that receives an id in its payload; a vector search without the workspace filter.

The scoped Prisma client from Milestone 3 injects `workspace_id` into every query and every create, so leaving it out is not possible in ordinary calls. What remains: raw SQL (banned on tenant tables), background jobs (they must carry an explicit workspace context), and the tests, where every new tenant table gets a cross-tenant test.
</details>

### Exercises

**A. Removal, then re-entry.** Add a test: a member is removed from a workspace, then calls `POST /auth/switch-workspace` with that workspace's id. It should get 403. The existing tests cover switching by someone who never belonged, but not after removal. (I replaced my earlier wording of this exercise, which asked about re-registering with the same email. That cannot work, because the email is unique and registering again returns 409, so there is nothing to test.)

Your result:

**B. Session length.** Change the session length to 1 day using only `.env`. Which code did you need to touch? What happens to cookies people already have?

Your result:

<details>
<summary>Hints</summary>

B: set `SESSION_DAYS=1`. No code changes, since the value is read in `apps/api/src/config/env.ts` and used by the session service. Existing cookies keep the expiry they were issued with, so they still last up to 7 days.
</details>

**C. Leave workspace.** Add a "Leave workspace" action for non-owners. What rule does the API need (who may leave, what about the last admin), and which existing test pattern do you copy?

Your result:

<details>
<summary>Hints</summary>

C: the owner cannot leave (they would orphan the workspace). Anyone else can remove their own membership. Copy the "removed member loses access" test in `apps/api/test/tenant-isolation.e2e.spec.ts`. Remember the person still needs at least one workspace, which the personal workspace guarantees.
</details>

---

## Milestone 3: document upload and storage

### Quiz

**1. We decide a file's type from its bytes, not from its extension or the type the browser reports. What does that stop, and what does it not stop?**

Your answer:

<details>
<summary>Answer key</summary>

It stops a file pretending to be something else: an executable renamed `invoice.pdf`, or binary data named `notes.txt`. The name and the browser's type are text the user controls, so they prove nothing.

It does not prove the file is well formed or safe. A file can start with `%PDF-` and still be corrupt, or be a crafted PDF or zip built to attack a parser. Signature checks are a first filter. The real parser in Milestone 4 must handle bad input itself, and DOCX (a zip) needs a guard against decompression bombs there.
</details>

**2. The duplicate check is per workspace, not across the whole system. Why?**

Your answer:

<details>
<summary>Answer key</summary>

A global check would leak information. If Bob's upload is refused with "already exists" because Alice uploaded the same file in a different company, Bob has learned what Alice's company holds. Per workspace, each tenant only ever sees its own state. The same file can live in two workspaces.

It also matches how ownership works: each workspace's copy is its own document that can be deleted independently.
</details>

**3. The storage key is generated (`<workspaceId>/<documentId>`) and the user's file name is only kept for display. What could go wrong if the file name became part of the path?**

Your answer:

<details>
<summary>Answer key</summary>

Path traversal: a name like `../../etc/passwd` could write outside the storage folder, overwrite another tenant's file, or overwrite application files. Names can also collide (two people uploading `report.pdf`), contain characters that are invalid on some systems, or be very long.

With generated keys nothing from the upload reaches the path. The storage class also refuses keys that are not plain segments and checks the final path stays inside the folder, so a bug elsewhere cannot turn into a traversal.
</details>

**4. The scoped database client refuses operations it does not recognise instead of passing them through. Why deny by default?**

Your answer:

<details>
<summary>Answer key</summary>

Pass-through means every operation Prisma adds later, or that we forgot about (raw queries, some aggregate forms), silently skips the workspace filter. The failure is invisible: it looks like a working query that returns other people's data. Refusing turns a future mistake into a loud error the first time it runs, in a test, instead of a leak in production.

It is the same idea as the guard that protects every route unless it is marked public.
</details>

**5. Delete removes the database row first, then the file. What could go wrong with the opposite order, and what can go wrong with ours?**

Your answer:

<details>
<summary>Answer key</summary>

File first, then row: if deleting the row fails after the file is gone, you have a document in the list whose file does not exist. Every later step (processing, showing the source) fails on it, and the user cannot fix it.

Row first, then file: if deleting the file fails, you have an orphan file nothing points to. That is harmless garbage a cleanup job can remove later. We log a warning for it.

The rule: when two steps cannot be made atomic, fail in the direction that leaves the least damaging state.
</details>

**6. In Milestone 4 a background job will process a document. It has no request and no session, only a document id. Where should its workspace come from, and how does it use the scoped client?**

Your answer:

<details>
<summary>Answer key</summary>

The workspace id is put into the job's data by the server when the job is created (right after the upload has been authorised), and never taken from anything a user typed. The worker reads it from the job and calls `forWorkspace(prisma, job.workspaceId)`, then loads the document through that client, so a wrong id simply finds nothing.

A job that receives only a document id and looks it up with the plain client would bypass every protection we built, which is why the plain client is not allowed on tenant tables.
</details>

### Exercises

**A. Support Markdown.** Add `.md` files. List every place that must change before you write code (database, detection, upload code, front end, tests), then do it. How does a Markdown file differ from plain text for detection?

Your result:

**B. One number in five places.** Set `MAX_UPLOAD_MB=2` in `.env` and restart the API. Upload a 3 MB file in the browser. What happens, and how many places still say 10 MB? Make the browser read the limit from one source.

Your result:

**C. Test first.** Add `GET /documents/:id` (one document's details) using the scoped client. Write the cross-tenant test first (another workspace's id gives 404), watch it fail, then make it pass. Then break the scoped client on purpose and check your test goes red.

Your result:

<details>
<summary>Hints</summary>

A: schema enum `DocumentType`, `EXTENSION_KIND` and `detectKind` in `file-type.ts`, the front end's allowed list in `apps/web/src/lib/types.ts`, and tests. Markdown is plain text with no signature, so it is checked the same way as TXT (no NUL bytes, valid UTF-8) and the extension is what distinguishes it. Detection cannot tell a `.md` from a `.txt`, which is acceptable and worth saying out loud.

B: the API answers 413 for the 3 MB file. The browser still says "10 MB" in its help text, in its own size check, and in the `MAX_UPLOAD_BYTES` constant, and the web proxy limit in `next.config.ts` must stay above the API limit. Expose the limit through an API endpoint or a shared build-time setting so it exists once.

C: copy the "knowing a document's id does not let you delete it from another workspace" test in `documents.e2e.spec.ts`. Use `findUnique({ where: { id }, select: ... })` on the scoped client and turn null into a 404.
</details>

---

## Milestone 4: reading documents in the background

### Quiz

**1. We store the extracted text one row per page, not as one big string. Why?**

Your answer:

<details>
<summary>Answer key</summary>

Citations need to say which page an answer came from, and that only works if page boundaries survive. A blank page keeps its number, so every later page number stays true. Pages are also natural limits for chunking (a chunk should not silently cross a page break), and a page can be shown or re-read on its own. The cost is a few more rows, which is small.
</details>

**2. A job crashes after saving 3 of 10 pages and the queue runs it again. What should happen to those 3 pages, and how does the code guarantee it?**

Your answer:

<details>
<summary>Answer key</summary>

Nothing should remain from the crashed run, and the re-run should produce exactly 10 pages. Two things guarantee it. The pages and the Ready status are written in one transaction, so a crash before it finishes rolls everything back and the 3 pages never existed. And even if old pages are present, the processor deletes the document's pages first and then inserts the new ones, so a repeat run replaces instead of adding. The test "replaces earlier pages instead of adding to them" checks it.
</details>

**3. A damaged PDF fails at once, but a database error is retried. Why treat them differently, and what goes wrong if you get it backwards?**

Your answer:

<details>
<summary>Answer key</summary>

A damaged file will be damaged every time, so retrying only delays the answer and hides the real reason. A database error is about the system, not the file, and usually passes, so retrying it works. If you retry permanent errors, users wait through pointless attempts. If you treat temporary errors as permanent, documents fail for no lasting reason and people have to re-upload. Our rule: anything the extractor throws for a bad file is permanent. Anything outside it (storage, database, Redis) is temporary, with 3 attempts.
</details>

**4. The header-removal rule compares lines exactly, with one special case for page numbers, instead of ignoring digits in every line. Why?**

Your answer:

<details>
<summary>Answer key</summary>

If digits are ignored, lines that differ only by a number look identical. "Invoice 1001" at the top of page 1 and "Invoice 1002" at the top of page 2 would be treated as one repeated header and deleted, and they are real content. Page numbers are the one case where the digits change on every page but the line is still boilerplate, so bare page-number lines ("Page 3 of 10", "- 4 -", "7") share one key. The rule also ignores pages with fewer than 5 lines, because in a tiny page every line is at an edge.
</details>

**5. The sweeper has to look at documents in every workspace, which breaks our "always use the scoped client" rule. How is that contained?**

Your answer:

<details>
<summary>Answer key</summary>

The cross-workspace query lives in one file, `worker/system-queries.ts`, which returns ids only. Everything the worker then does with a document goes through the scoped client, using the workspace id from the job. A guard test scans the source and fails if the plain client touches a tenant table anywhere else (the seed is the other allowed place). An exception is acceptable when it is small, named, and enforced by a test.
</details>

**6. Queues usually deliver a job at least once. Name two ways one document could be processed twice, and say why each is harmless.**

Your answer:

<details>
<summary>Answer key</summary>

Examples: the worker finishes the work but dies before telling the queue, so the queue runs it again; the sweeper re-queues a document while the original job is still waiting; someone presses Retry twice. Each is harmless because the processor skips a document that is already Ready, and because saving replaces the pages in one transaction, so a second run either does nothing or produces the same result.
</details>

### Exercises

**A. Page sizes in the panel.** Show each page's character count in the extracted-text panel. Which parts must change (the API response, the type, the component)?

Your result:

**B. Break Redis on purpose.** Stop Redis (`docker compose stop redis`), upload a file, start Redis again (`docker compose start redis`). Write down what you see and when. What rescues the document, and how long does it take?

Your result:

**C. A new cleaning rule, test first.** Table-of-contents lines with dot leaders ("Introduction ........ 3") add noise. Write a failing test for a rule that removes the dots but keeps the title and number, watch it fail, then add the rule in `clean-text.ts`. What could this rule wrongly change?

Your result:

<details>
<summary>Hints</summary>

A: the pages endpoint already returns text, so the count is `text.length`, computed in the component. No API change is needed, which is a fair answer to "which parts must change".

B: the upload succeeds and the row stays Uploaded, because adding the job failed after the file was saved. The sweeper finds documents stuck for over 5 minutes at its next minute-long sweep, so expect about 5 to 6 minutes. Also watch the API and worker logs: they reconnect by themselves.

C: a regex such as `/\.{4,}/` replacing the dots with a single space is a start. It could also change a line in ordinary text that uses a long run of dots on purpose (for example a fill-in-the-blank line), and it keeps the page number attached to the title.
</details>

---

## Milestone 5, before coding

Concepts are in `docs/learning/milestones/M05-chunking-and-embeddings/concepts.md`. Answer before or after the milestone. Nothing waits on it.

**1. Which pair will have the higher cosine score, and why?**

- A: "How many vacation days do I get?" and "Employees receive 25 days of annual leave."
- B: "How many vacation days do I get?" and "Vacation photos must not be posted on the company blog."

Your answer:

<details>
<summary>Answer key</summary>

A should score higher. Embeddings compare meaning, and A is one question and its answer, with no shared words except "days". B shares the word "vacation" but is about something else. This is the reason semantic search finds "annual leave" when you ask about vacation. Two cautions. Scores of unrelated text are still middling (0.59 in our Milestone 1 test), so the gap matters and the absolute number does not. And embedding models can surprise you, which is why Checkpoint A of Milestone 5 runs exactly this pair and prints the real numbers. Nothing in this answer is measured yet.
</details>

**2. For a 20-page policy document, would you pick 100-token chunks or 1000-token chunks? What goes wrong at each extreme?**

Your answer:

<details>
<summary>Answer key</summary>

Neither extreme. A starting point of 400 to 500 tokens with about 10 to 15 percent overlap is common, and Milestone 6 measures it. At 100 tokens a chunk often holds half an idea, loses words like "it" and "the policy above", and needs more chunks (more embedding calls and more results to sort through). At 1000 tokens one vector covers several topics, so it matches none of them well, and each retrieved chunk fills a lot of the answer prompt with text that is not needed. The right size depends on the documents and the questions, which is why we test it with numbers.
</details>

---

## Milestone 5: chunking and embeddings

Reading: `docs/learning/milestones/M05-chunking-and-embeddings/` (`concepts.md`, `01-llm-fundamentals.md`, `02-embeddings.md`, `03-chunking.md`). Nothing waits on your answers.

### Quiz

**1. The embedding cache is keyed by the workspace, the fingerprint of the chunk text, and a "setup id". What is in the setup id, and what goes wrong if the key used only the text fingerprint?**

Your answer:

<details>
<summary>Answer key</summary>

The setup id names everything that decides what a vector means: the model, the number of dimensions, and a fingerprint of the instruction wording added in front of each text (`gemini-embedding-2|768|<8 characters>`). With only the text fingerprint, changing the model, the size or the wording would silently reuse vectors from the old setup. Vectors from different setups cannot be compared: a question embedded with the new setup would be scored against chunks embedded with the old one, and the scores would be meaningless without any error. With the setup id in the key, old vectors are simply not used, the chunks count as "not embedded" again, and the system embeds them once more.
</details>

**2. Embedding runs as its own job, on its own queue, one job at a time, after reading. Why not do it inside the reading job?**

Your answer:

<details>
<summary>Answer key</summary>

Embedding is slow and limited by the provider's tokens per minute (a 300 chunk document takes minutes on the free tier), while reading takes well under a second. Inside one job, a long embedding would hold a worker slot and delay the reading of other documents. A separate queue with concurrency 1 also matches the limiter, which lives in one process. The split also lets the document show two honest states (Processing, then Indexing with progress), lets each step retry on its own terms (embedding waits 30 seconds between attempts, reading waits 5), and means a failure in embedding does not throw away the extracted text.
</details>

**3. A 300 chunk document is being embedded and the provider fails after 120 chunks. What is saved, what does the retry do, and why is pressing Retry cheap even after the document was marked Failed?**

Your answer:

<details>
<summary>Answer key</summary>

Vectors are saved after every group of 16 texts, together with the note on each chunk that it has a vector, so the 112 to 128 chunks already done are kept (the first 7 or 8 groups). A retry by the queue only embeds the chunks that have no vector, so nothing already paid for is sent again. If every attempt fails, the document is marked Failed, but the vectors stay in the cache table. Pressing Retry reads the document again from the start (new chunks), and the embedding step finds each chunk's text in the cache by its fingerprint, so only the texts that were never embedded go to the provider. The tests "continues where it stopped" and "Retry later only pays for what is missing" check this.
</details>

**4. The limiter assumes 3 characters per token, but chunk sizes assume 4. Why the difference, and what can still go wrong?**

Your answer:

<details>
<summary>Answer key</summary>

Sizing chunks with 4 gives chunks a little smaller than planned for English, which does no harm. The limiter is different: guessing too few tokens lets us send more than the per-minute budget and get refused, and refusals waste time and use quota. So it guesses more tokens (3 characters per token), which is safe but makes English text about a third slower. It can still go wrong for text with far more tokens per character: in Checkpoint A, codes and numbers were 72% under-estimated with 4, and even 3 leaves them low (93 characters were 82 tokens, estimated 31). Then a call can still be refused, and the retry with backoff is what recovers. Also, the limiter lives in one process: two workers would each assume the whole budget.
</details>

**5. A search returns a top score of 0.71, a second score of 0.70, and an unrelated chunk scores 0.60. What can you conclude, and what can you not conclude?**

Your answer:

<details>
<summary>Answer key</summary>

You can conclude that both top chunks are somewhat closer to the question than unrelated text is, and that the ranking puts them first. You cannot conclude that the top one answers the question: 0.71 against 0.70 is a tiny gap, and even unrelated text scores about 0.6 with this model (Checkpoint A: 0.59 for a kitchen sentence). Scores are relative, so a fixed cutoff such as "above 0.5 is relevant" would accept everything. What helps is looking at gaps, keeping several chunks, measuring retrieval on real questions (Milestone 6), and later reranking (Milestone 11).
</details>

**6. When a document is deleted, its vectors are deleted too, except a vector that another document still uses. Why both parts?**

Your answer:

<details>
<summary>Answer key</summary>

A vector is data derived from the document's text. If it stayed after the document was deleted, derived data would outlive the thing the person chose to remove. So the vectors of its texts are deleted. But two documents can contain the same paragraph and then share one cached vector (the cache is keyed by the text). Deleting that vector would leave the other document with a chunk that claims to be embedded but has no vector, so it would silently drop out of search. The code collects the fingerprints first, deletes the document, keeps every fingerprint still used by another chunk in the workspace, and deletes the rest. Tests cover a unique text, a shared text, and the last document using it.
</details>

### Exercises

**A. Ask your own questions.** After `bun run --cwd apps/api embed:backfill`, run `bun run --cwd apps/api search --workspace "Acme Corp" "<question>"` with three questions: one that uses different words from the document (a synonym), one with an exact name or number, and one the documents cannot answer. For each, write down whether the right chunk is first, and the gap between rank 1 and rank 2.

Your result:

**B. Watch the cache work.** Set `CHUNK_TARGET_TOKENS=150` and `CHUNK_OVERLAP_TOKENS=20` in `.env`, run `bun run --cwd apps/api chunks:rebuild`, then `bun run --cwd apps/api embed:backfill`. How many texts were sent to Gemini and how many were served from the cache? Then set them back to 500 and 60 and repeat. What does the second run tell you about the cache?

Your result:

**C. Show the gap.** Change `apps/api/src/scripts/search.ts` so it also prints the difference between the score of rank 1 and rank 2 under the results. Why is the gap more informative than the top score alone?

Your result:

<details>
<summary>Hints</summary>

A: the synonym question is the interesting one, it is where meaning search should beat keyword search. For the exact number question, look at whether the score gap is larger or smaller than for the synonym one, and think about what hybrid search (Milestone 11) is for. For the unanswerable question, the search still returns five chunks with scores: nothing in this step says "I don't know".

B: with the smaller target, the chunks are different texts, so most are sent to Gemini. When you go back to 500 and 60, the chunks have the same text as before (the same fingerprints), so the cache answers and almost nothing is sent, unless you deleted the vectors. This is why the cache key is the text and the setup, not the document.

C: `hits[0].score - hits[1].score`, when there are at least two hits. The gap says how clearly the top result stands out from the rest, which is what a person needs to judge. A high top score with no gap means several chunks are about equally close.
</details>

---

## Milestone 6, before coding

Concepts are in `docs/learning/milestones/M06-qdrant-retrieval-and-eval/concepts.md`. Answer before or after the milestone. Nothing waits on it.

**1. A test set has 20 questions. For 8 of them the right chunk is ranked first, for 14 of them it is in the top 3, and for 6 it is not in the top 5. What are hit rate@1 and hit rate@3? Why can two searches with the same hit rate@3 still differ in quality?**

Your answer:

<details>
<summary>Answer key</summary>

Hit rate@1 is 8 / 20 = 0.40. Hit rate@3 is 14 / 20 = 0.70. Two searches can have the same hit rate@3 and still differ: one may rank the right chunk first every time and the other third every time. Hit rate@3 cannot tell them apart. MRR can: it averages 1 / rank, so first place counts 1 and third place counts 0.33. Ranking matters because later steps read the top results first and the answer prompt has limited room. Also note that 20 questions is small: one question is 5 percentage points, so a difference of 0.05 between two runs is one question and should not be trusted.
</details>

**2. Workspace A has 3 relevant chunks for a question. Workspace B has 50 chunks that are even closer to it. A search asks for the top 5 and removes the results that are not in workspace A afterwards. What does A get, and what is wrong with the approach besides that?**

Your answer:

<details>
<summary>Answer key</summary>

A gets nothing: the 5 closest chunks in the whole collection all belong to B, and removing them leaves an empty list, even though A has 3 good chunks. The second problem is privacy and isolation: the search touched B's data while working for A, and a small mistake in the removal step would leak it. The correct approach filters during the search, so only points where the workspace equals A are considered and the top 5 come from A's own chunks. The filter must be mandatory in the search function, with a test that fails when it is missing.
</details>

---

## Milestone 6: Qdrant retrieval and the mini evaluation

Reading: `docs/learning/milestones/M06-qdrant-retrieval-and-eval/` (`concepts.md`, `05-retrieval.md`, `07-evaluation.md`, and the results of Checkpoints C and D). Nothing waits on your answers.

### Quiz

**1. All three chunking strategies scored 100% on hit rate @3 and @5. What does that tell you about the strategies, and what would make the comparison more sensitive?**

Your answer:

<details>
<summary>Answer key</summary>

It tells you almost nothing about the strategies. The corpus has only 36 chunks in seven guides, and four of the guides have 3 or 4 chunks each, so once search picks the right guide, the top 5 contains the whole guide and a hit is guaranteed. This is a ceiling effect: the test is too easy at those cutoffs. The numbers that could still move were hit rate @1 (88.9%, 66.7%, 83.3%) and MRR (0.944, 0.815, 0.907). To make the comparison more sensitive: more and harder questions (vague wording, answers that need two chunks), a bigger corpus, and reading @1 and MRR instead of @5. It is also a reason not to quote "100% hit rate" on its own.
</details>

**2. `paragraph` got the right chunk first for 16 of 18 questions and `heading` for 15 of 18. Is `heading` worse? And how is that different from `fixed`, which got 12 of 18?**

Your answer:

<details>
<summary>Answer key</summary>

You cannot conclude that `heading` is worse. One question is 5.6 percentage points, and the two questions where `heading` ranked lower had tiny margins: on q20 the paragraph strategy had a tie (0.755 against 0.755) and `heading` lost to the overview chunk by 0.011, and on q22 three paternity chunks scored 0.768, 0.764 and 0.760. Its top score was higher than `paragraph`'s on 13 of 18 questions. The honest result is "no measurable difference on this question set". `fixed` is different: it is four questions behind, it ranks lower than `paragraph` on 5 questions and higher on 1, and its top score is lower on 16 of 18. Every measure points the same way, so that difference is much more believable. A useful habit: look at which questions flipped and by how much, not only at the totals.
</details>

**3. Each question is judged by "the retrieved chunk is from this document and contains this quote", not by a chunk id. Why, and what does the approach cost?**

Your answer:

<details>
<summary>Answer key</summary>

Chunk ids change every time a document is cut again, and the milestone compares different ways of cutting, so an id from one strategy means nothing in another. A quote is the same under every strategy, so all of them are judged by one standard. The costs: someone has to write and check a quote for every question, a quote that a chunk boundary cuts in half can never be found (the harness reports those separately as "cut through", 0 in our runs, and short quotes make them rare), and a repeated passage can make two chunks both count as correct. Requiring the document name as well as the quote stops the same sentence in another guide (the same £194.32 appears in the maternity and paternity guides) from counting.
</details>

**4. Why must you decide which questions to keep before looking at how search handles them? What limits the numbers we got anyway?**

Your answer:

<details>
<summary>Answer key</summary>

If you keep the questions the search answers well and drop the ones it fails, the score rises and means nothing: you have chosen the test to fit the system. The decision has to be made first, on one criterion (could a real person ask this?). In our set the assistant chose keep or drop, before any search results existed, which avoids that trap. But no human wrote or reworded the questions, so their wording stays close to the guides' own wording (a real employee says "doctor's note", the guide says "fit note"). Search does better when words are shared, so the scores probably lean high. Also the set is small (18 answerable), and one corpus of one kind of document. These limits are written next to every number.
</details>

**5. The evaluation run stops with an error if Qdrant holds a different number of points than Postgres holds chunks, instead of printing a warning and continuing. Why?**

Your answer:

<details>
<summary>Answer key</summary>

A half-built index makes search miss chunks that exist, so the score falls for a reason that has nothing to do with the strategy or the model, and it looks like a real result. A number that carries a warning tends to be copied without it, into a table or a document, and then it is an unexplained fact. The stored run is the evidence that every number in the docs comes from, so it must not be produced when it would be misleading. The same rule applies when an expected quote is not in its document (a typo would count as a miss) and when the chunks have no vectors under the current embedding setup.
</details>

**6. The closest chunk scored 0.665 to 0.798 for questions the guides answer and 0.627 to 0.717 for questions they do not. Could a score cutoff make the system say "I don't know"?**

Your answer:

<details>
<summary>Answer key</summary>

Not reliably. The ranges overlap. The highest unanswerable question (q29, about Statutory Adoption Pay, which the guides only name) scored 0.717, above two answerable questions (0.665 and 0.707). A question near a topic the guides mention but do not answer still matches strongly. As an illustration, a cutoff at 0.70 would refuse one real question and still answer q29, and a cutoff at 0.72 would refuse all four unanswerable questions and three answerable ones. With only 4 unanswerable questions this shows a direction, not a rule, and choosing a cutoff on the same questions would be tuning on the test. In Milestone 8 "I don't know" will need more than one score, for example the gap between results, an answer that must cite its sources, and a larger set of unanswerable questions.
</details>

**7. A document is deleted while Qdrant is down. What happens to the document, its points, and search? How would you find out and fix it?**

Your answer:

<details>
<summary>Answer key</summary>

Postgres and Qdrant cannot be changed in one transaction, so Postgres is treated as the truth and Qdrant is written last. The document row (and its pages and chunks, by cascade) is deleted first. Removing its points from Qdrant fails, which is logged and does not stop the delete. The points stay behind but are harmless: search reads the chunk text from Postgres, and a point whose chunk no longer exists is skipped. To find them, `bun run --cwd apps/api qdrant:sync --check` compares the two stores and reports stale points without changing anything. `bun run --cwd apps/api qdrant:sync` removes them. The same tool rebuilds Qdrant completely from Postgres without any call to Gemini, which is why storing chunk text and vectors in Postgres matters.
</details>

### Exercises

**A. Judge a chunk label.** Run `bun run --cwd apps/api chunks:lab ../../eval/corpus/govuk/govuk-holiday-entitlement-rights.txt --show heading`. Find the chunk whose `heading` label describes its content least well. What would a better label be, and how would you produce it in code?

Your result:

**B. Write harder questions.** Copy `eval/questions/govuk.json` to `eval/questions/mine.json`. Write five questions in your own words that do not use the guides' keywords, with quotes, and set them to `keep`. Do this before running anything. Then `bun run --cwd apps/api eval:check --questions ../../eval/questions/mine.json`, and run `eval:run --questions ../../eval/questions/mine.json --strategy paragraph --label mine` and again with `--strategy heading`, then `eval:compare` on the two files. Did the hit rate @1 change? Did any strategy fail on a question you expected it to get?

Your result:

**C. Show who improved.** Change `apps/api/src/scripts/eval-compare.ts` (and `evaluation/compare.ts` if you prefer) so that, for each run after the first, it prints how many answerable questions ranked better and how many ranked worse than in the first run. A miss counts as the worst rank.

Your result:

<details>
<summary>Hints</summary>

A: chunk 4 of the heading strategy for that guide contains the answer to the carry-over question and is labelled "Example", because the label is the first section's heading and a chunk packs several sections. A better label would list every heading in the chunk, or the most specific one for each part. In code, `chunkByHeadings` knows the sections it packs into a chunk (`open`), so it could collect their headings instead of keeping only the first.

B: `eval:check` makes no Gemini call and tells you if a quote is not in the guide. The two runs send only your five short questions to Gemini (public text). Compare runs are only allowed when both used the same question file, which is why both use `mine.json`. Decide which questions to keep before the first run, not after.

C: treat `null` as a large number, for example `const worse = (a, b) => (a ?? 99) > (b ?? 99)`. Loop over `result.questions`, skip questions that are not answerable, and compare `ranks[i]` with `ranks[0]`.
</details>

---

## Milestone 7: Basic RAG

Reading: `docs/learning/milestones/M07-basic-rag/` (`concepts.md`, `04-rag.md`, and the results of Checkpoints B and C). Nothing waits on your answers.

### Quiz

**1. The grounding rule ("only answer from what you're given") is set once, in the system instruction, not typed into every question. Why there, and what would go wrong putting it in the user prompt instead?**

Your answer:

<details>
<summary>Answer key</summary>

The rule has to hold for every question with no exceptions, so it belongs in the one fixed slot that is sent unchanged on every call. Putting it in the user prompt would mean retyping it (or a prompt-building function forgetting to) each time, and it would sit next to the question as just more text to weigh against, instead of as a standing instruction above it. `GeminiLlmClient.generate()` already separates `system` from `prompt`; this milestone was the first to put real content in the system slot.
</details>

**2. Milestone 6 found that a retrieval score cannot reliably separate answerable from unanswerable questions. What replaced it here, and what is the new approach's own weakness?**

Your answer:

<details>
<summary>Answer key</summary>

A fixed refusal phrase in the system instruction, checked in the model's reply with `startsWith()`, exposed as `noAnswer: boolean`. The weakness: it depends on the model actually producing that exact sentence when it decides to refuse. Nothing here verifies the claims in an answer against the passages it was given, which is why this is explicitly temporary; Milestone 8 replaces it with structured, verified output.
</details>

**3. Retrieval finds nothing at all for a question (an empty workspace). What does the API do, and why is that better than calling the model anyway?**

Your answer:

<details>
<summary>Answer key</summary>

It returns the fixed "not found" answer directly and skips the model call entirely. The content of that answer is already known before asking, so paying for a generation call (money, latency, a free-tier request against the rate limit) would buy nothing. Tests confirm the fake LLM's `calls` count stays at zero in this case.
</details>

**4. A live check showed the Ask page stuck on "Searching your documents..." for well over a minute, even though the server log showed retrieval had finished in under two seconds. What was actually happening, and what was added to fix it?**

Your answer:

<details>
<summary>Answer key</summary>

Generation (the real Gemini call) was still in progress; during a demand spike it took over a minute, sometimes several. The page had no way to know retrieval had already finished and generation had started, so it kept showing text that was no longer accurate. The fix: `answerStream()` now yields a `status` event ("retrieving", then "generating") before any answer text, and the page's waiting message follows it, so a long wait during generation reads as "the model is busy," not as "nothing is happening."
</details>

**5. The custom SSE event sent when a stream fails is named `failed`, not `error`. Why does the name matter, not just its contents?**

Your answer:

<details>
<summary>Answer key</summary>

The browser's `EventSource` reserves the event name `error` for its own connection failures (a plain `Event`, dispatched with no data, to whatever listener is registered for "error"). If the server also sent a named `error` event, a real application failure (a Gemini error, say) and a genuinely dropped connection would arrive at the exact same listener, and the client would have no reliable way to tell them apart. A test checks the event's name directly, not only that it carries the right message, because a mutation that reused "error" would otherwise pass a test that only checked the content.
</details>

**6. A live check found the app's generic `/api/*` proxy killed a long-lived streaming connection after about 150 milliseconds, every time. How was this actually diagnosed, rather than guessed, and why was the fix a dedicated Route Handler instead of a change to the proxy's configuration?**

Your answer:

<details>
<summary>Answer key</summary>

A script read the response chunk by chunk with timestamps, once through the normal proxy (port 3000) and once straight to the API (port 3001). Through the proxy the connection died at about 150ms every time; straight to the API it stayed open correctly until a real result arrived, 20 to 30 seconds later. That isolated the fault to the proxy, not to the Nest code or to Gemini, and it was confirmed by reproducing it four times, not once. The fix used a real Next.js Route Handler (`apps/web/src/app/api/ask/stream/route.ts`) that explicitly pipes the upstream response's `ReadableStream` body through, because Next.js documents that pattern for proxying a stream; the generic `rewrites()` config is a general-purpose URL rewrite, not built or documented for a long-lived streaming body, and changing it would have meant hoping it worked rather than knowing why it would.
</details>

### Exercises

**A. Compare the two paths.** Ask the same question through `POST /ask` (for example with curl, or a small script like the ones used to verify this milestone) and through the Ask page in the browser. Compare `usage.retrievalMs` and `usage.generationMs` between the two calls.

Your result:

**B. Shrink the budget on purpose.** Temporarily set `CONTEXT_TOKEN_BUDGET` in `apps/api/src/rag/prompt.ts` to something small, like 200, restart the API, and ask a question where several documents are relevant. How many sources come back now, compared to before? Put the constant back afterward.

Your result:

**C. Ask something borderline.** Ask a question close to what the documents cover but not quite answered by them (a topic only named in passing, not explained). Look at the `sources` the API returns even though `noAnswer` is true, and their scores. Are they close to what an answerable question scores, or clearly lower?

Your result:

<details>
<summary>Hints</summary>

A: the two calls go through the exact same `RagService` retrieval code, so the retrieval time should be close between them. Generation time will vary more, since it depends on Gemini's response time at that moment.

B: with a small budget, `buildContext` keeps the first (best-scoring) chunk even if it alone is over budget, then stops before adding a second one that would pass it. Expect one source, maybe two, instead of up to five.

C: retrieval almost always finds something (embedding similarity rarely returns literally nothing), so `sources` is usually non-empty even for a refused question, because those chunks were shown to the model and it chose not to use them. Milestone 6 found these near-miss scores often sit close to real answers' scores, which is exactly why a score alone cannot decide "I don't know."
</details>

---

## Milestone 8: Citations

Reading: `docs/learning/milestones/M08-citations/` (`concepts.md`, `citations.md`, and the Checkpoint B results). Nothing waits on your answers.

### Quiz

**1. The non-streaming `/ask` endpoint uses a real JSON schema (`responseSchema`) to get its citations. The streaming endpoint does not, even though it needs citations too. Why not?**

Your answer:

<details>
<summary>Answer key</summary>

JSON is not valid until the whole object has been produced; a streaming reply sends words as they are generated, so there is no safe moment to parse partial JSON. The streaming endpoint instead relies on a prompt convention (`[N]` markers written directly into the flowing prose) and parses them out with a regex only once the full text has arrived. It is a weaker guarantee (the mapping is assumed by convention, not declared explicitly by the model), accepted specifically to keep Milestone 7's streaming code unchanged.
</details>

**2. A citation comes back `verified: true`. What exactly has been checked, and what has deliberately not been checked?**

Your answer:

<details>
<summary>Answer key</summary>

Checked: the citation's `sourceIndex` names a passage that was really included in the context sent to the model (`context.used`), so it is not an invented or out-of-range number. Not checked: whether the passage actually supports the sentence it is attached to (faithfulness). That is a real evaluation problem, assigned on purpose to Milestone 10's LLM-judge harness, not attempted here.
</details>

**3. Why is an unverified citation shown in the UI, with a warning state, instead of just being removed from the answer?**

Your answer:

<details>
<summary>Answer key</summary>

Silently dropping it would make the answer look more confident and trustworthy than it actually is, which is the opposite of what citations exist to do. `FRONTEND_RULES.md` states this directly: an unverified citation is shown as unverified, never silently dropped and never shown as valid.
</details>

**4. What happens if the non-streaming endpoint's structured reply is not valid JSON, or is missing a field?**

Your answer:

<details>
<summary>Answer key</summary>

`parseStructuredAnswer()` returns `null` instead of throwing. `RagService.answer()` then falls back to treating the raw text as a plain, uncited answer: `citations` comes back empty, but the answer itself is not lost. This is also what kept every one of Milestone 7's original tests passing unchanged, since their fake replies are plain sentences, not JSON.
</details>

**5. The backend already returns a `citations` array. Why does the frontend run its own separate regex pass over the answer text, instead of just using that array directly to decide what to show?**

Your answer:

<details>
<summary>Answer key</summary>

The `citations` array only says which markers exist and whether they are verified; it does not say *where* inside the answer text each `[N]` sits. The frontend has to find each marker's actual position in the text to know what to replace with a clickable chip and what to leave as plain prose around it. The backend regex (`parseInlineMarkers`) answers "which citations exist"; the frontend regex answers "where exactly do I put a chip instead of these bracket characters."
</details>

**6. The source panel highlights the entire cited chunk, not just the sentence the answer actually used from it. What would it take to highlight only that sentence, and why wasn't it built this milestone?**

Your answer:

<details>
<summary>Answer key</summary>

It would need matching the answer's wording against the passage's wording well enough to find the one supporting sentence, including when the answer paraphrases rather than quotes. That is a real natural-language matching problem, not a lookup. Highlighting the whole chunk is always correct (the model really was shown that whole passage) if less precise, and was the deliberate, budget-appropriate choice for this milestone.
</details>

### Exercises

**A. Trace one citation end to end.** Ask a question that your demo documents answer, open the citation chip that appears, and confirm the passage shown in the source panel is really the numbered passage the system prompt would have labelled with that same number.

Your result:

**B. Try to produce a real unverified citation.** Ask a few different questions and see if you can get the real model to cite a number it was not actually given (for example, by asking something where five documents are relevant but the model might miscount). If you cannot, that itself is worth noting: it means the checkpoint's honest gap (only the fake-client test has ever exercised the unverified path) is still true.

Your result:

**C. Compare the two endpoints on the same question.** Ask the same question through `POST /ask` and through the Ask page (streaming). Are the citations identical in both? Should they be, given how differently each one is produced?

Your result:

<details>
<summary>Hints</summary>

A: `apps/api/src/rag/prompt.ts`'s `buildContext()` numbers passages in the order Qdrant ranked them, best score first; that numbering is what both `sourceIndex` and the source panel's position in the `sources` array refer to.

B: real models are usually careful about citing only what they were given, especially with a strict grounding instruction already in the system prompt. A clean result here is a sign the prompt is working, not a sign nothing was tested; the automated test suite is what actually proves the unverified path works when it does happen.

C: they should usually agree, since both endpoints retrieve and build context the exact same way and only differ in how the citation is extracted from the model's reply. A real difference would suggest the model behaved differently between a schema-forced call and a free-text one, which would be worth a closer look.
</details>
