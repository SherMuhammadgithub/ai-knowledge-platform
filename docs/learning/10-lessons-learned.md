# Lessons learned

Things that went wrong or surprised us, kept short. Newest at the bottom. Each one is something to say in an interview, because it is real. Feeds the final case study.

## Milestone 1

- **Read the quota before choosing a model.** We picked `gemini-3.6-flash`, then found it allows 20 requests a day. Switched to `gemini-3.5-flash-lite` (500 a day). Quotas are per model, so the evaluation judge can use a different model with its own budget.
- **A model in the list can still return 404.** `gemini-2.5-flash` is listed but unavailable to new accounts. Make one real call before pinning a model.
- **Thinking models spend tokens you cannot see.** A 20-token output cap gave an empty answer with HTTP 200, because thinking used the budget. We default to minimal thinking and log thought tokens.
- **A batch of embeddings silently became one vector.** `gemini-embedding-2` merged a plain string array. Found only because the client checks the count and size of what comes back. Every embedding path keeps that check.
- **Docs disagreed with each other.** One page said `gemini-embedding-001` and `gemini-embedding-2-preview`, another said `gemini-embedding-2`. Ask the API (`list:models`), do not trust summaries.
- **The embedding limit that matters is tokens per minute** (30K), not requests. It shapes how we build the embedding pipeline: cache by content hash, limit by tokens.
- **Toolchain drift.** Nest CLI 12 does not work with TypeScript 7. `bun add -d prisma` resolved to a release candidate (8.0.0-rc.15) while the client was 7.10.0. Pin exact versions and check what an install actually resolved.
- **Cosine scores are relative.** Unrelated text scored 0.59, not near 0. A fixed cutoff cannot be guessed. Measure it.

## Milestone 2

- **Prisma 7 does not run `generate` after `migrate dev`.** The typecheck passed with no client because nothing imported it yet. Generate explicitly.
- **`nest start` does not load `.env`.** Found only by running `bun run api`. The scripts now pass `--env-file`.
- **Tests that cannot fail prove nothing.** We broke the guard and the workspace filter on purpose, saw the right 4 tests go red, and restored them. Do this for every new tenant table.
- **When my own check failed, I worked out which side was wrong before changing anything.** My script kept an old cookie, the product was right.
- **A fixture can be wrong, not the product.** A demo user in only one company workspace was stuck after being removed, which real sign-ups cannot cause. The seed now gives every demo user a personal workspace.
- **An outage needs a designed screen.** The first thing you hit was the API not running, and my web app answered every page with a raw 500. Test with each backend switched off, not only on.
- **A library can warn for good reasons.** `next-themes` (latest) renders a script from a client component, which React 19 warns about on every load. We replaced it with an inline script in the server layout plus a small hook, and tested the logic with a stub browser, including blocked storage.
- **Automated tools can see what checks cannot.** Typecheck and lint passed, but headless Chrome screenshots showed a stray gap, a repeated subtitle, inputs blending into the page and a wrapping brand name.
- **Default looks are a tell.** You rejected the colored left border on the active tab as looking generated. The rule was changed first, then the code.
- **Check unfamiliar packages before trusting them.** The shadcn CLI added a package called `cn`. Its repository is `shadcn-ui/cn`, MIT, no install scripts.
- **Small environment traps.** A Windows username with a space breaks paths built from `import.meta.url` (use `fileURLToPath`). `shadcn add` stops at an interactive overwrite prompt. Do not run `next build` while `next dev` runs in the same folder.

## Milestone 3

- **Test through the real front door.** A file just over 10 MB gave 413 straight from the API but 500 through the web proxy, because the proxy buffers request bodies up to 10 MB. Only a browser test through the proxy showed it. We raised the proxy limit and tested the exact 10 MB boundary.
- **Look at the screen, again.** Screenshots showed the M2 "Remove member" button was brand teal, not red: a class override lost to the button's own background. The component has a `destructive` variant, use that. The same pass found the phone table hiding the status and the delete button.
- **Deny by default beats "remember to".** The scoped database client refuses operations it does not know, exposes only tenant models, and two guard tests fail when someone adds a tenant table or a raw query carelessly. Rules a human must remember get forgotten.
- **A fixture must be as real as what it stands for.** My fake "xlsx" was pure text, which really is valid text, so the test failed. Real zip headers contain zero bytes.
- **Types can force the wrong thing to be written.** Prisma's typed `create` requires a `workspaceId` even though the scoped client sets it. We pass it, and the client's overwrite guarantees it cannot differ.
- **Order of side effects matters.** Delete the database row first, then the file. The reverse order can leave a row pointing at nothing.
- **Duplicates need the database, not only a check.** Two identical uploads at once both pass a "does it exist" check. The unique index makes exactly one win, and the loser cleans up its file.
- **Read the docs for the version you have.** Next 16's proxy body limit is an experimental setting with its own page in the bundled docs, found by searching them.
- **A seed should only touch what it owns.** It leaves accounts it did not create alone, so your own account survives a reseed.

## Milestone 4

- **Try the new library before designing around it.** BullMQ 6 and pdfjs 6 were both newer than what I knew. A ten line experiment against real Redis and a real PDF showed the API (`ioredis` is a peer dependency now, pdfjs loads with `require()` on Node 22.13 or newer) before any design was written.
- **A rule can be wrong in a way that only real data shows.** Ignoring digits when looking for repeated headers made "Invoice 1001" and "Invoice 1002" the same line and would have deleted real content. A test with realistic pages caught it. Exact repeats plus bare page numbers is safer, and small pages are left alone.
- **Failure is a result, not an accident.** A scan with no text should be Failed with a reason a person can act on, not an empty document that never matches anything. And decide early which errors are the file's fault (fail now) and which are the system's (retry).
- **Make every job safe to run twice**, because queues deliver at least once. Skip finished work, write results in one transaction that replaces what was there, and tolerate a document that vanished.
- **A safety net needs its own tests.** The sweeper found stuck documents, but only a mutation test showed it would re-queue the same ones every minute without remembering what it did.
- **Test the process you think you are testing.** The API on port 3001 was an orphaned copy of the Milestone 3 code, so uploads never queued. The response having no `pageCount` field gave it away.
- **Stopping a dev server is not the same as stopping its watcher.** Four leftover `nest start --watch` processes held about 1 GB. Stop the top of the process tree and list what remains.
- **Two watchers must not share an output folder.** The worker compiles into its own `dist-worker`.
- **The clever trick can fail in the test runner.** A dynamic-import workaround for an ES module worked in production and failed under Vitest. The boring `createRequire` worked in both.
- **Invisible characters in source are a trap.** Some ended up as literal soft hyphens and zero-width spaces. Write them as visible escapes.
- **Duplicate protection shows up in your own tests.** Two fixtures built from identical bytes collided on the unique (workspace, hash) rule.
- **Seed data should run through the real code.** The demo documents are read by the same pipeline as uploads, so a Failed sample fails for its real reason.
- **Measure before answering "how long".** Reading takes well under a second for typical text files, with a one-time 3.7 s cost for the first document after the worker starts.

## Milestone 5

- **A convenient query can leak data.** The first token-count check took the longest pages from the dev database, which included resume files a person had uploaded by hand, and sent them to the free-tier API. Filter by what you are allowed to send (the seeded "(sample)" documents), not by what is convenient. Check where the data comes from before a script talks to an outside service.
- **Measure the rule of thumb before building on it.** `characters / 4` was off by +19% on prose and -72% on codes. Neither breaks chunking, but one would break a per-minute limiter.
- **One example is not a result.** The exact code ERR-4021 was found by meaning search, but it was in both texts. It shows the case works, not that keyword search is unneeded.
