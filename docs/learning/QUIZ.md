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

Background reading for each part is in the other files in this folder: `09-production-ai.md` (Milestone 1), `tenant-isolation.md` (Milestones 2 and 3) `file-uploads.md` (Milestone 3), and `text-extraction.md` and `background-jobs.md` (Milestone 4).

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
