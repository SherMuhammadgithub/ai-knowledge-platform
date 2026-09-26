# Progress

**Current milestone:** 8 (citations) is built and live-checked with real Gemini 2026-09-26, waiting on the user's own browser check (`docs/learning/milestones/M08-citations/checkpoint-b-results.md`). Quizzes for Milestones 1 to 7 are unanswered in `docs/learning/QUIZ.md` and do not block anything.
**Next action:** the user does the browser check for Milestone 8 and reports back. Once confirmed, Milestone 8 closes out (topic note, quiz, docs) and Milestone 9 (conversational RAG) starts with concepts and a plan.

## Milestones

- [x] 1. Architecture and setup (quiz parked until M5)
- [x] 2. Auth and workspaces (quiz pending)
- [x] 3. Document upload and storage (quiz pending)
- [x] 4. Processing worker (quiz pending)
- [x] 5. Chunking and embeddings (quiz pending)
- [x] 6. Qdrant retrieval + mini eval (quiz pending)
- [x] 7. Basic RAG (quiz pending)
- [ ] 8. Citations (built and live-checked, waiting on the user's browser check)
- [ ] 9. Conversational RAG
- [ ] 10. Full evaluation
- [ ] 11. Hybrid search and reranking
- [ ] 12. Security
- [ ] 13. Production hardening
- [ ] 14. Deployment and documentation

## Milestone 1 checklist

- [x] `git init`, `.gitignore`, `.env.example` (no commit made yet)
- [x] Bun workspace: `apps/api`, `apps/web`, `eval/`
- [x] Docker Compose: Postgres 17.11 (host port 5433), Qdrant v1.19.1, Redis 8.8.2. All three verified healthy
- [x] NestJS API skeleton, `/health` verified on Node 22
- [x] Next.js 16 + Tailwind 4 skeleton, production build passes
- [x] Zod env loader that fails fast (`apps/api/src/config/env.ts`)
- [x] `LlmClient` / `EmbeddingClient` interfaces, rate limiter, retry with backoff, usage log (`apps/api/src/llm/`)
- [x] Gemini implementations, typechecked against the real SDK (`apps/api/src/llm/gemini/`)
- [x] shadcn/ui installed in `apps/web` (`radix-nova`, Lucide, `button` only). Palette, fonts and radii set in `globals.css`. Contrast of every text pair checked (`bun run --cwd apps/web check:contrast`, all pass in light and dark)
- [x] Frontend rules written: `docs/FRONTEND_RULES.md`, imported by `apps/web/CLAUDE.md`
- [x] Temporary home page shows the design language once. Replaced in M2
- [x] Gemini API key in `.env` (user)
- [x] Verified models with `list:models` and real calls. Docs pages were each partly right: all three embedding models exist for this key. Recorded in `PLAN.md`
- [x] Free-tier limits read from AI Studio by the user (screenshot). Generation switched to `gemini-3.5-flash-lite` (3.6-flash has only 20 requests/day). Limiters split per model (`GEMINI_GENERATION_RPM=12`, `GEMINI_EMBEDDING_RPM=80`). Recorded in `PLAN.md`
- [x] `smoke:gemini` passes on the final config (`gemini-3.5-flash-lite` + `gemini-embedding-2`, 768 dims; related 0.79 vs unrelated 0.59 cosine)
- [x] Record chosen models, dimension and limits in `docs/PLAN.md`

## Milestone 2 checklist (auth and workspaces, 2026-09-19)

- [x] Prisma 7.10.0 (CLI and client pinned to the same exact version) with `@prisma/adapter-pg`. Config `apps/api/prisma.config.ts`, schema `apps/api/prisma/schema.prisma`, generated client in `apps/api/src/generated/prisma` (git-ignored, run `db:generate` after a fresh install)
- [x] Migration `init`: `users`, `workspaces`, `memberships` verified in Postgres
- [x] Design approved by the user: active workspace in the session JWT, guard re-checks membership every request, argon2id, one 7-day cookie
- [x] Auth API: register (user + personal workspace + owner membership in one transaction), login, logout, me, switch-workspace. argon2id via `@node-rs/argon2`. Same 401 message and same work for unknown email and wrong password
- [x] `SessionGuard` as a global guard: secure by default, `@Public`, `@UserOnly`, `@Roles`, `@CurrentWorkspace`
- [x] Workspaces API: create, list members, add member by email, remove member. Owners add admins, admins add members, the owner cannot be removed
- [x] 21 automated tests against a separate `akp_test` database. Mutation-checked: removing the membership check or the workspace filter turns 4 tests red
- [x] Web: sign in and create account pages (validation on blur, server errors), app shell (sidebar, workspace switcher, mobile sheet, theme choice, sign out), Documents empty state, Members page with add and remove, loading skeleton, error page, "choose a workspace" screen when access is revoked
- [x] End-to-end check through the web proxy with curl: register, cookie is HttpOnly, pages render for the signed-in user, signed-out redirects to login, signed-in `/login` redirects home. Throwaway account deleted afterwards
- [x] Demo seed (`bun run seed`, `apps/api/src/scripts/seed.ts`): 7 fake users, 9 workspaces, repeatable, refuses production and remote databases. Scenarios verified through the real API. Step-by-step checks with expected results: `docs/DEMO_GUIDE.md`
- [x] Fixed after the user's first run (2026-09-19): API not running made every page a raw 500, and `next-themes` caused a React 19 "script tag" console warning. Layouts now show a "Cannot reach the server" state with a retry button, and the theme is a small in-house provider. Checked with the API down, the API up, and a headless Chrome console capture
- [x] Auth and shell redesign (user feedback, 2026-09-19): sign-in and create-account are now a two-column page with a static example answer, its citation and the highlighted source passage (the highlight sweeps in once), a show/hide password control, and a logo mark. Sidebar active tab is a filled tint with a teal icon, no left border. Checked in headless Chrome at 1280px (light and dark) and 390px, signed out and signed in, with no console warnings
- [ ] Visual check in a real browser by the user (the Chrome tools available to me were on other machines): the user should look at login, register, members, mobile width and dark mode

Known gaps, on purpose (nothing here is forgotten):
- No rate limiting or lockout on login (M13).
- No Origin check on state-changing requests. `SameSite=Lax` covers the common case (M13).
- Register reveals whether an email exists (409). Accepted for now. Password reset, email verification and invites are out of scope.
- Members can only be added if they already have an account.
- Documents page has no upload button yet, so its empty state has no action (M3 adds it).
- Access token and membership check cost one indexed query per request. Fine at this scale.

## Milestone 3 checklist (document upload and storage, 2026-09-19)

- [x] `Document` table (migration `documents`): workspace, uploader, original name, type, size, SHA-256 hash, storage key, status. Unique on (workspace, hash), index on (workspace, created)
- [x] Workspace-scoped client `forWorkspace()` (`apps/api/src/prisma/tenant-client.ts`): injects `workspace_id` into every query and create, drops attempts to set or change it, refuses operations it does not know, exposes only tenant models. Obtained through `TenantPrismaService.for(actor)`
- [x] Two guard tests: every schema model with a `workspaceId` must be registered as tenant or exempt (Membership is exempt on purpose), and the source may not contain raw SQL
- [x] `StorageService` with a local-disk implementation (keys checked, path must stay inside the folder, never overwrites), default folder `<project>/storage` (git-ignored)
- [x] File type decided from bytes (PDF, DOCX, TXT), must match the extension. Names cleaned and used for display only. Size cap while streaming (`MAX_UPLOAD_MB=10`). Duplicates per workspace by SHA-256, including two at the same moment
- [x] API: `POST /documents`, `GET /documents`, `DELETE /documents/:id`. Members delete only their own uploads, admins and owners any
- [x] 76 automated tests (55 new), all passing. Mutation-checked in two rounds: 18 tests went red when the filters, ownership, signature check and storage-key check were broken, and the two guard tests fired when a table was left unregistered and when raw SQL was added. All restored
- [x] Seed extended: 3 fictional sample documents in Acme Corp, 2 in Globex. Files and rows agree, and repeat runs replace them
- [x] Web: Documents screen with upload (button and drag and drop, several files, per-file result list), table with status, delete with confirmation, empty state, loading skeleton
- [x] Checked in Chrome through the web proxy: good file uploaded, executable named .pdf refused, png refused, duplicate refused, a file of exactly 10 MB accepted, 10 MB plus one byte refused with 413, delete works, Globex sees only Globex documents. Screenshots reviewed in dark, light and phone widths
- [ ] Try it yourself in a browser: `docs/DEMO_GUIDE.md` checks K to M

Known gaps, on purpose:
- Uploaded documents stay "Uploaded". Reading their text, chunking and embedding start in Milestone 4.
- Type checks look at signatures, they do not prove a file is well formed. DOCX (a zip) needs a decompression guard in the extractor (M4).
- Through the web proxy, a body above 20 MB answers 500 instead of 413. The browser UI never sends one (it checks size first). Direct API callers get 413.
- Local disk storage only. Deployment needs an object store behind the same interface.
- No download endpoint yet. The source-passage viewer in Milestone 8 needs one.

## Milestone 4 checklist (processing worker, 2026-09-19 and 2026-09-20)

- [x] Schema: `document_pages` (one row per page, tenant table) and on `Document`: `page_count`, `char_count`, `processed_at`, `updated_at`. Two migrations
- [x] Extraction: PDF page by page with pdfjs 6 (loaded with `require()`, Node 22.13 or newer), Word with mammoth, TXT decoded. `apps/api/src/processing/`
- [x] Cleaning: ligatures and invisible characters, split words rejoined, mid-sentence line breaks joined (PDF only), repeated headers and footers and bare page numbers removed (exact repeats only, pages need 5 lines of text). Every rule has a test and a documented cost
- [x] Limits: 300 pages, 60 seconds, 3 million characters, zip-bomb guard from declared sizes (100 MB unpacked, 2000 entries)
- [x] Failure is a result: no text, damaged, password protected, too big, missing file give Failed at once with a plain reason. Temporary errors retry 3 times (5 s, then 10 s) and then fail with "temporary problem"
- [x] Queue and worker: BullMQ 6 on Redis (`ioredis` is a peer dependency now). Producer fails fast when Redis is down. Worker is a second process, `bun run worker`, compiled into its own `dist-worker` so it never fights the API's watcher
- [x] Repeatable jobs: already Ready is skipped, pages and Ready status written in one scoped transaction that replaces earlier pages, deleted document and wrong workspace do nothing
- [x] Sweeper: every minute, documents Uploaded or Processing for over 5 minutes are queued again. Its one cross-tenant query lives in `worker/system-queries.ts`, ids only
- [x] API: `POST /documents/:id/retry` (same permission as delete, only for Failed) and `GET /documents/:id/pages`
- [x] Scoped client covers `documentPage` and transactions. New guard test: the plain client may not touch a tenant table outside the system queries and the seed
- [x] 129 automated tests (53 new). Mutation-checked: 8 deliberate breaks turned 12 tests red (page scoping, replace-old-pages, already-done check, permanent versus temporary, sweeper memory, sweeper filter, zip-bomb guard, page limit), the plain-client guard fired, everything restored
- [x] Real run: a generated 3-page PDF went Uploaded to Ready with the compiled worker, header and footer removed, "man-ager" rejoined. The sweeper picked up 7 stale demo documents at worker start. `bun run worker` verified starting
- [x] Measured reading time on generated text PDFs: 10 pages 0.06 s, 100 pages 0.2 s, 300 pages 0.7 s, Word 2000 paragraphs 0.07 s, first document after worker start about 3.7 s extra (loads the PDF library). Real PDFs with heavy fonts or images were not measured
- [x] Seed reads its 8 sample documents through the real pipeline (7 Ready, 1 Failed with its real reason). `bun run samples` writes files for manual uploads to `demo-files/`
- [x] Web: status badge with icon and reason line, live updates every 3 seconds while anything is in progress, Retry for failed documents, click a Ready document to read its extracted text page by page. Typecheck and lint pass
- [x] Browser check of the Documents screen, 2026-09-20, headless Chrome as Alice with the real API and worker: PDF, Word and a scan uploaded, each ended Ready or Failed with no refresh (Ready with page or character count, Failed with the no-text reason), text panel showed 3 pages with header, footer and page numbers removed and "quar-" "ter" rejoined, Retry on the scan ran again and failed for the same reason, no console errors or warnings, test uploads deleted afterwards. Not seen live: the Uploaded and Processing states, because the worker finished in under a second. Those were seen by the user earlier when the worker was off ("Taking longer than usual")
- [ ] Redis outage recovery (`docs/learning/background-jobs.md`, Try it 3): the sweeper logic is tested, the whole outage sequence was not run by hand

Known gaps, on purpose:
- Scans and images (OCR) are not read. They fail with a clear reason. Belongs to Project 5.
- PDF reading order for multi-column pages and tables can interleave. Out of scope for this project.
- The worker is started by hand (`bun run worker`), with no supervisor to restart it. Deployment work (M14).
- The provider rate limiter is per process. Sharing it through Redis is M13 work, and matters from M5 when the worker calls Gemini.
- The screen polls every 3 seconds instead of receiving pushes.
- Retry counts and waits (3 attempts, 5 s doubling) are a first guess.
- Tests leave about 26 small keys under `akp-test:` in Redis. Harmless and namespaced.
- No download endpoint yet (the source viewer in M8 needs one).

## Milestone 5 checklist (chunking and embeddings, 2026-09-20)

Plan and checkpoints: `docs/learning/milestones/M05-chunking-and-embeddings/README.md`.

Checkpoint A (done): embedding docs read and recorded in `docs/PLAN.md`, `bun run lab:embeddings` (meaning search scores and token estimate check), results in `checkpoint-a-results.md`.

Checkpoint B (done, real worker path still to confirm after the user restarts the worker):
- [x] Table `document_chunks` (migration `document_chunks`), registered as a tenant table, covered by the scoped client and its guard tests
- [x] Two chunkers, `fixed` and `paragraph`, plain functions with tests, including a random test over 300 pages and four size settings
- [x] Processor cuts chunks and saves them with the pages and the Ready status in one transaction, replacing earlier chunks
- [x] `GET /documents/:id/chunks`, `chunkCount` on every document, `bun run --cwd apps/api chunks:rebuild [--strategy fixed]`, seed uses the same chunker
- [x] Web: Chunks tab (with overlap shown as tinted text and a caption), chunk count in the row. Checked in a browser in light and dark, at 390 px, with keyboard
- [x] 161 API tests (32 new). 10 deliberate breaks all caught. Typecheck and lint clean in both apps
- [x] Dev data: chunks cut for the 10 existing Ready documents with the rebuild script
- [x] Real worker in the browser: confirmed with the restarted worker (see Checkpoint C)

Checkpoint C (done):
- [x] Cache and vector table `chunk_embeddings` (per workspace, keyed by text fingerprint and setup id), `embedded_with` on chunks, status `INDEXING` (migration `embeddings`)
- [x] Token-per-minute limiter (`characters / 3`, `GEMINI_EMBEDDING_TPM`), provider calls split by token budget, budget spent on every attempt including retries, setup id in the client
- [x] Embedding as its own job on a second queue with its own worker (one job at a time): cache first, groups of 16, saved after each group, progress text, temporary errors retried, errors that can never work (400, 401, 403, 404) fail at once with a reason
- [x] Status flow Uploaded, Processing, Indexing, Ready. Ready means searchable. Sweeper covers Indexing. Old Ready documents show "not searchable yet" until the backfill
- [x] Deleting a document deletes its vectors, except ones another document still uses
- [x] Plain search: `bun run --cwd apps/api search` (interactive) and `embed:backfill` (sample documents only by default, everything else listed as skipped)
- [x] UI: Indexing badge with progress, "searchable" in rows, vector status per chunk. Checked in a browser in dark mode and at 390 px
- [x] 203 API tests (42 new), 18 deliberate breaks all caught, typecheck and lint clean in both apps
- [x] Real runs: 9 texts sent to Gemini for the sample documents, then 0 sent and 9 from the cache after a full chunk rebuild. Live upload of two files through the user's worker ready in about 9 seconds. Vector count back to 9 after deleting them
- [x] Topic notes 01 to 03 and the Milestone 5 quiz written

Known gaps, on purpose:
- Embedding limiter lives in one process (Milestone 13). The sweeper can queue a slow embedding twice (harmless). Search compares every vector of the workspace (Qdrant in Milestone 6). No search box in the app yet (Milestone 7). Only the configured chunking strategy is embedded. No per-document "do not send to AI" switch (Milestone 12 or 13). The user's two resume files are Ready but not searchable, on purpose.
- Overlap is whole sentences only. When every sentence is longer than the overlap size a chunk gets none.
- A sentence that crosses a page break is cut at the page break.
- The Chunks tab shows only the configured strategy. Comparing strategies in the app is planned for the start of Milestone 6.
- Chunk sizes are starting guesses. Milestone 6 measures them.

## Milestone 6 checklist (Qdrant retrieval and the mini evaluation, 2026-09-21)

Plan and checkpoints: `docs/learning/milestones/M06-qdrant-retrieval-and-eval/README.md`.

Checkpoint A (done): Qdrant docs read and every behaviour we depend on checked by experiment (`docs/PLAN.md`). Corpus chosen and built: GOV.UK employment guidance, 7 documents (Open Government Licence v3.0, `eval/corpus/LICENSES.md`), loaded into its own workspace, 36 chunks, all embedded. Foundation review agreed. Results: `checkpoint-a-results.md`.

Checkpoint B (done and confirmed live):
- [x] Qdrant client pinned to 1.19.0. One collection (`QDRANT_COLLECTION`, default `akp_chunks`), cosine, 768 dimensions, tenant index on `workspace_id`, indexes on `document_id`, `strategy`, `setup_id`. Point id is the chunk id. Payload has ids and positions only
- [x] `VectorIndexService`: write a document's points then remove stale ones, delete a document's points, search with a filter on workspace (from the scoped client), setup and strategy that cannot be left out, counts
- [x] Ready now means "vectors made and in Qdrant". Qdrant down means the document stays Indexing and the queue retries. The API still starts with Qdrant down
- [x] Deleting a document deletes its points. If Qdrant is unreachable the document is still deleted and `qdrant:sync` cleans up
- [x] `qdrant:sync` (and `--check`), search through Qdrant with `--exact` and `--compare`
- [x] Real data: sync wrote 48 points with no Gemini calls, six baseline questions return the same chunks, order and scores as the exact loop
- [x] 221 API tests (18 new, real Qdrant), 13 deliberate breaks all caught, typecheck clean
- [x] Live upload through the restarted worker: two files went Uploaded, Indexing ("Adding to the search index"), Ready in under 5 seconds, `qdrant:sync --check` said in step (11 points), search agreed with the exact loop, deleting both removed their points

Known gaps, on purpose: the collection is too small for Qdrant to build its approximate index (0 indexed vectors), so the parity test proves wiring, not index quality. Postgres and Qdrant cannot be changed in one transaction, so `qdrant:sync --check` exists. A worker that has not been restarted after this change would make documents Ready without points, and `qdrant:sync` repairs that.

Checkpoint C (done):
- [x] Table `eval_runs` (tenant-owned, in `TENANT_MODELS`, isolation test) and migration `eval_runs`
- [x] `apps/api/src/evaluation/`: question file schema, quote matching (curly quotes, case and line breaks ignored), hit judging (document and quote), hit rate@1/3/5, MRR@5, top-score ranges for answerable and unanswerable questions, `checkQuotes`, `runEvaluation`, `saveRun`, `writeRunFile`
- [x] Scripts `eval:check` (no Gemini call) and `eval:run`. The run refuses when a quote is not in its document, when Qdrant and Postgres disagree, or when chunks have no vectors under the current setup
- [x] 32 candidate questions in `eval/questions/govuk.json` (27 answerable, 5 not), every quote tested against the guides and found in a single chunk of the real corpus (`eval:check`)
- [x] 258 API tests pass (37 new: 22 unit, 14 against real Postgres and Qdrant, 1 tenant isolation). 22 deliberate breaks: 21 caught, 1 changes nothing (unanswerable questions given a rank, already impossible because their hit flag is false). Two gaps found and closed: a test where every score was 1.0 could not see swapped columns, and the isolation of the new table
- [x] Live check with real Gemini and Qdrant on 3 throwaway questions (not in the set): one batch embedding call of 1.4 s, search, scores, a database row and a JSON file. The throwaway run was then deleted so it cannot be mistaken for a baseline
- [x] Questions chosen: at the user's request Claude set keep (22: 18 answerable, 4 unanswerable) or drop (10), judging only realism, before any search results. Not human-reviewed or reworded: the set may flatter search, and results must say so
- [x] Baseline run on `paragraph` chunks, stored (row `01a0c330-573c-746f-813d-363f36c69d2e`, `eval/runs/2026-09-21T08-58-40-paragraph-baseline.json`): hit rate @1 88.9% (16 of 18), @3 100%, @5 100%, MRR 0.944, 0 quotes cut by chunking. Top score 0.665 to 0.798 when answerable, 0.627 to 0.717 when not (ranges overlap). Results in `checkpoint-c-results.md`. Limits: 22 questions chosen by the assistant, 36 chunks, hit rate @5 is guaranteed for guides with 5 or fewer chunks

Checkpoint D (done): the chunking experiment. Results in `checkpoint-d-results.md`.
- [x] Heading detection (`chunking/headings.ts`): one short line, capital or digit first, not ending like a sentence, not a bullet, table row, link, e-mail or "Label: value". Read against all seven guides, no false headings found. Word heading styles not built
- [x] Heading-aware chunker: packs whole sections up to the target size, cuts only at headings, splits an oversized section with the paragraph chunker, no overlap between sections, a page with no headings is cut like `paragraph`. New nullable column `heading` (migration `chunk_heading`), filled only by the `heading` strategy. `CHUNK_STRATEGY` accepts `heading`
- [x] Scripts: `chunks:lab` (offline, shows headings and how each strategy cuts a file), `eval:prepare --strategy` (cut, embed, index for the eval workspace only, never re-cuts existing chunks), `eval:compare` (stored runs side by side, refuses runs from different question files or embedding setups). Tokens retrieved per question added to every run
- [x] Corpus embedded under `fixed` and `heading`: 14 Gemini calls, public text only. 107 points in the GOV.UK workspace (36 + 35 + 36)
- [x] Three stored runs on the same 22 questions (`paragraph` d3 row `01a0c3c9-3783-735c-9c91-89bfbaf1bb10`, `fixed` `01a0c3c9-7df3-746b-a1c3-9959f65bb7d0`, `heading` `01a0c3c9-9108-73a7-8e04-04f64452737b`). Hit rate @1: 88.9%, 66.7%, 83.3%. MRR: 0.944, 0.815, 0.907. Hit rate @3 and @5 are 100% for all (the corpus is too small to separate them). The `paragraph` re-run is identical to the baseline
- [x] Decision: default stays `paragraph`. `fixed` is clearly worse (5 questions lower, 1 higher). `heading` is within noise of `paragraph` (one question lower at rank 1). Correction to Checkpoint C: q04 is second under all three strategies, so a boundary cut was not the whole story
- [x] 312 API tests pass (54 new). 30 deliberate breaks: all accounted for (dead rule removed, two test gaps closed, one break changes nothing)
- Not tested: chunk sizes, Word heading styles, PDFs with the heading strategy, a larger corpus. `qdrant:sync` fills and compares only the configured strategy

Checkpoint E (done): closing.
- [x] Topic notes `05-retrieval.md` and `07-evaluation.md` in the milestone folder (the second grows in Milestone 10)
- [x] Milestone 6 quiz (7 questions) and exercises (3) in `docs/learning/QUIZ.md`
- [x] `docs/DEMO_GUIDE.md` check T (evaluation and chunking strategies), test count 312
- [x] Milestone README, milestone index, learning index, `10-lessons-learned.md`, `CLAUDE.md`
- [x] Correction made while writing the notes: Qdrant's `full_scan_threshold` is in kilobytes of vector data (about 3,300 vectors of our size), not 10,000 points. Fixed in `docs/PLAN.md`, `CLAUDE.md`, the Checkpoint A results and the retrieval note. Checked against Qdrant's docs and the live collection (119 points, 0 indexed vectors)

**Milestone 6 summary.** Qdrant holds the vectors (mandatory workspace, setup and strategy filters, Postgres authoritative, `qdrant:sync` to compare and repair). An evaluation harness scores hit rate @1/3/5 and MRR against expected quotes, stores every run (database and `eval/runs/`), and refuses to score a half-built index or a wrong quote. 22 questions chosen by the assistant, 7 GOV.UK guides, 36 chunks. Baseline and comparison: `paragraph` 88.9% at rank 1 (MRR 0.944), `heading` 83.3% (0.907), `fixed` 66.7% (0.815). Default stays `paragraph`. 312 API tests. Limits: hit rate @3 and @5 are at the ceiling, no human reworded the questions, chunk sizes were not tested, Qdrant's approximate index was never in use at this size.

Checkpoint B (done): the answer endpoint.
- [x] `RagService.answer()` (`apps/api/src/rag/`): retrieve through the existing Qdrant search (same code the evaluation harness and the search script use), skip the model call when nothing is retrieved, build numbered context capped by a token budget, generate at temperature 0.2 with a fixed system instruction, detect the model's own refusal by an exact phrase, return sources limited to what was actually shown to the model
- [x] `POST /ask`, workspace-scoped like every other tenant route, Zod-validated
- [x] 328 API tests pass (16 new: 9 unit, 7 end-to-end with a fake LLM). 10 deliberate breaks, all caught (two mutation-script bugs found and fixed along the way)
- [x] Live check, real Gemini, Acme Corp's fictional demo documents: a correct grounded answer with real sources, a correct refusal for an unanswerable question
- [ ] Not yet explained: both live generation calls took 1 to 2 minutes (one had 3 retries, one succeeded first try and was still slow). Noted, not investigated (a Milestone 13 question)

Checkpoint C (done in code, mostly live-verified): streaming and the Ask page.
- [x] `RagService.answerStream()`, `LlmClient.generateStream()`, `GET /ask/stream` (Nest `@Sse`), sharing retrieval with the plain endpoint. 5 new e2e tests, 7 deliberate breaks all caught. 333 API tests total
- [x] The Ask page (`apps/web/src/components/ask-view.tsx`): waiting, streaming (Stop button, cursor, `aria-live`), done, refused (plain text, never red), failed (retry) states. Sources plain, similarity scores only inside a closed Details disclosure, in mono. Build and lint pass, contrast unchanged
- [x] Found and fixed a real bug: the generic `/api/*` rewrite proxy killed the SSE connection after about 150ms. Fixed with `apps/web/src/app/api/ask/stream/route.ts`, a real Route Handler that streams the upstream body directly (Next checks the filesystem before an array-form rewrite applies). Reverified 4 times: the connection now survives 20 to 30 seconds, matching a direct call to the API
- [x] Live-verified: the zero-hits path (via tests), and a real Gemini failure streamed cleanly end to end (a `failed` event, not a broken connection), reproduced 4 times
- [ ] Not verified live: a full successful streamed answer. Gemini (`gemini-3.5-flash-lite`) returned "high demand" 503s on every one of 4 real attempts over several minutes. Very likely the explanation for Checkpoint B's unexplained latency too, though not confirmed beyond this session
- [x] User's first live try found a real gap: the page stuck on "Searching your documents…" with no sign of progress once generation started (retrieval finished in under 2 seconds per the API log, generation can take a minute or more). Fixed: `answerStream()` now sends a `status` event (`retrieving`, then `generating`) before any text, and the page's waiting text follows it. 4 more deliberate breaks, all caught (333 tests total, unchanged: existing tests updated, not added)
- [x] The user checked it live in their own browser (2026-09-23) and confirmed it works

**Milestone 7 summary.** Question in, grounded answer out, streamed to a minimal Ask page. Retrieval and context-building shared between the plain and streaming paths. "I don't know" handled by a fixed refusal phrase, not a score (Milestone 6 showed a score cutoff cannot separate answerable from unanswerable reliably). Two real bugs found live and fixed, not just noted: an SSE event name colliding with the browser's own reserved `error` handling, and the generic proxy killing the SSE connection after about 150ms (fixed with a dedicated Route Handler). A UX gap found on the user's own first live try (no sign of progress once generation started) fixed with a `status` event. 333 API tests, typecheck and the web build all clean. No citations, no conversation history, no dollar cost: all deliberately left to later milestones.

## Environment (checked 2026-09-19)

Node v22.18.0, Bun 1.4.0, Docker 29.4.0, Git 2.51.0, Python 3.13.7. Host port 5432 is used by something else on the dev machine.

## Quiz and exercise log

All quiz questions and exercises live in `docs/learning/QUIZ.md`, with a place for the user's answers. Status: Milestone 1 quiz (5 questions) and exercises (3) unanswered. Milestone 2 quiz (4 questions) and exercises (3) unanswered. Milestone 3 quiz (6 questions) and exercises (3) unanswered. Milestone 4 quiz (6 questions) and exercises (3) unanswered. The user answers when they choose, and does not need to before the next milestone, except M1 question 1 before Milestone 5. Record checked results here.

## Decisions and lessons

- 2026-09-19: Bun instead of pnpm (user's choice). Bun is package manager and script runner only. Nest, BullMQ and Prisma stay on Node 22.
- 2026-09-19: Nest CLI 12 does not work with TypeScript 7 (no programmatic compiler API until 7.1). Pinned `typescript@^6` in `apps/api`. TS 6 also removed `moduleResolution: node10` and `baseUrl`, and requires `rootDir`.
- 2026-09-19: Top-level `await` is not allowed with CommonJS output, so scripts wrap their code in `main()`.
- 2026-09-19: UI is a demo priority (user decision), so the plan's "no UI polish" stance is replaced by `docs/FRONTEND_RULES.md`. Polish comes from the design system, not per-screen tweaks.
- 2026-09-19: shadcn's generated CSS had `--font-sans: var(--font-sans)` (self-reference) and `layout.tsx` still wired Geist. Fixed by using distinct font variable names.
- 2026-09-19: A model in the API's model list can still return 404 (`gemini-2.5-*` for new accounts). Verify with a real call before pinning.
- 2026-09-19: Thinking models spend hidden tokens against `maxOutputTokens`, so a small cap can give an empty answer. Client defaults thinking to `minimal` and records thought tokens.
- 2026-09-19: `gemini-embedding-2` merges a plain `string[]` into one vector. Found only because the client validates count and dimension. Every embedding path must keep that check.
- 2026-09-19: Picked `gemini-3.6-flash` before reading the quota table, then found it allows 20 requests per day. Lesson: read quotas before choosing a model, not after. Quotas are per model, which lets the M10 judge use a separate model and a separate daily budget.
- 2026-09-19: Embedding limit that matters is 30K tokens per minute, not requests. Content-hash embedding cache and a token-based limiter (M5) are required.
- 2026-09-19: Two Gemini docs pages disagreed about the embedding model name. Lesson: ask the API (`list:models`) instead of trusting docs summaries.
- 2026-09-19: `bun add -d prisma` resolved to `8.0.0-rc.15` (a release candidate, not what `latest` implies) while `@prisma/client` resolved to 7.10.0. Pinned both to exact 7.10.0. Prisma 7 needs `prisma.config.ts`, generator `prisma-client` with an explicit `output`, and a driver adapter. The docs URL for v7 differs from the default quickstart (which describes v8).
- 2026-09-19: Prisma 7 `migrate dev` does not run `generate`. `tsc` passed with no client because nothing imported it yet. Generate explicitly, and `prebuild` runs it.
- 2026-09-19: `nest start` does not load `.env`. Scripts now run `node --env-file=../../.env`. Found only by actually running `bun run api`.
- 2026-09-19: A supertest request built up front and awaited later fails with ECONNREFUSED. Build each request lazily, one at a time.
- 2026-09-19: Isolation tests were mutation-checked (deliberately broke the guard and the workspace filter, saw the right tests fail, restored). Do the same for every new tenant table.
- 2026-09-19: shadcn's `add` command stops at an interactive "overwrite button.tsx?" prompt. Answer `n` by piping input.
- 2026-09-19: The browser talks only to :3000. Next rewrites `/api/*` to the NestJS API, so the cookie is same-origin and needs no CORS.
- 2026-09-19: A demo user who is only in one company workspace would have no workspace after being removed (real sign-ups never hit this because registering creates a personal workspace). The seed gives every demo user a personal workspace. Backing out of a state that real flows cannot reach is a sign the fixture, not the product, is wrong.
- 2026-09-19: When a check I wrote failed, I confirmed which side was wrong before changing anything: my script kept an old cookie, the product was right. Automated tests use a cookie-keeping agent for this reason.
- 2026-09-19: The first thing the user hit was the API not running, and my web app answered with a raw 500 on every page, including sign-in. Any dependency outage must have a designed state. Test the app with each backend off, not just on.
- 2026-09-19: `next-themes` 0.4.6 (latest) renders a `<script>` inside a client component, which React 19 warns about on every page load. Replaced with an inline script from the server layout plus a `useSyncExternalStore` hook. The theme logic was checked against stub browsers, including blocked `localStorage`.
- 2026-09-19: Headless Chrome (`--headless=new --enable-logging=stderr --dump-dom`) can capture browser console output from the dev server. First confirm it captures known messages (React DevTools notice, HMR), otherwise an empty result proves nothing.
- 2026-09-19: Do not run `next build` while the user's `next dev` is running in the same folder.
- 2026-09-19: User rejected the left-border active tab as looking generated. Rule changed first (`FRONTEND_RULES.md`: no colored side stripes on nav items, cards, alerts or rows), then the code.
- 2026-09-19: Headless Chrome driven by `puppeteer-core` from a scratch folder outside the project lets me actually look at screenshots. It found four faults that typecheck and lint could not: a stray gap before a comma, a repeated subtitle, inputs blending into the page, and a wrapping brand name (kept as a two-line lockup).
- 2026-09-19: The shadcn CLI now generates `export { cn } from "cn"`. `cn` is shadcn's own package (`github.com/shadcn-ui/cn`, MIT, no install scripts), replacing `clsx` plus `tailwind-merge`. Checked before trusting it.
- 2026-09-19: The Windows username contains a space, so paths built from `import.meta.url` need `fileURLToPath`. Dev-only note: the Next.js round dev badge (bottom-left) overlaps the sidebar user menu. It does not exist in production builds.
- 2026-09-19 (M3): A file just over 10 MB returned 413 directly from the API but 500 through the web proxy. Next's proxy buffers request bodies up to 10 MB by default, and a file near the limit plus form overhead crosses it. Raised to 20 MB in `next.config.ts` (`experimental.proxyClientMaxBodySize`). Always test the whole path, not only the API.
- 2026-09-19 (M3): Screenshots showed the "Remove member" button from M2 was brand teal, not red. Class overrides on `AlertDialogAction` lose to the button's own background. The component has `variant="destructive"`. Fixed in both dialogs and written into the frontend rules.
- 2026-09-19 (M3): The scoped client is tested three ways: pure unit tests of the rules, tests against the real database, and guard tests that fail when someone adds a tenant table or a raw query carelessly.
- 2026-09-19 (M3): Typed `create` still requires a `workspaceId` even though the scoped client overwrites it. It is passed explicitly, and the overwrite guarantees it cannot differ from the caller's workspace.
- 2026-09-19 (M3): The seed leaves accounts it did not create alone, so your own account and workspaces survive a reseed.
- 2026-09-20 (M4): Before writing code against BullMQ 6 and pdfjs 6, both newer than what I knew, a small real experiment showed the API: `ioredis` is now a peer dependency of BullMQ, and pdfjs works from CommonJS through `require()` of its ES module on Node 22.13 or newer.
- 2026-09-20 (M4): A first "`new Function` dynamic import" for pdfjs worked in production but failed inside the test runner. Plain `createRequire` works in both.
- 2026-09-20 (M4): The header-removal rule ignored digits, so "Invoice 1001" and "Invoice 1002" looked identical and real content would have been deleted. A test found it. Now: exact repeats plus bare page-number lines only, and pages under 5 lines are left alone.
- 2026-09-20 (M4): Some invisible characters (soft hyphen, zero-width space, ligatures) ended up as literal characters in source files. Converted to visible escapes. Check source bytes for invisible characters.
- 2026-09-20 (M4): The API on port 3001 was a leftover process with no parent, still running the Milestone 3 code, so uploads never queued. The response shape gave it away (no `pageCount` field). When testing, confirm the running process is the new build.
- 2026-09-20 (M4): Four `nest start --watch` processes of mine had leaked from earlier sessions (about 1 GB). My stop commands matched the wrong pattern. Rule now in `CLAUDE.md`: stop the top process of the tree, then list what is left.
- 2026-09-20 (M4): Two Nest watchers writing to the same `dist` folder fight each other. The worker compiles to `dist-worker`.
- 2026-09-20 (M4): The sweeper needs to remember what it queued, or it queues the same documents every minute. A mutation test proved it.
- 2026-09-20 (M4): Two test documents built from identical bytes collided on the unique (workspace, hash) rule. The duplicate protection working.
- 2026-09-20 (M5): A property test that called `expect()` once per character timed out (54 s for 300 pages). Collect the failures, assert once: 3.5 s.
- 2026-09-20 (M5): The random property test found a real chunker bug (a chunk that repeated the previous one) that the hand-written tests missed. Keep both kinds of test.
- 2026-09-20 (M5): Radix tabs open on a real mouse press. A synthetic `element.click()` in a browser script does nothing. Use the driver's own click.
- 2026-09-20 (M5): A browser script that fails before its cleanup leaves test data behind and then trips the duplicate check on the next run. Clean up at the start as well as the end.
- 2026-09-20 (M5): The `bg-muted` tint was clear in light and almost invisible in dark. Look at both themes before calling a highlight done.
- 2026-09-20 (M5): The worker is not a watch process, so it kept running the old code after the change. Compare a process's start time with the time of the last code change before trusting it.
- 2026-09-20 (M5): The first token-count script sent hand-uploaded resume text to the free tier. See the rule in `CLAUDE.md` about what may be sent to a provider.
- 2026-09-20 (M5): A deliberate-break run found a weak test of mine: "search only finds Ready documents" used a document with no vectors, so the filter was never needed. The test now uses a document with vectors that is not Ready yet. Ask what a test would look like if the code were wrong, then make it fail.
- 2026-09-20 (M5): `bun run <script> "words with spaces"` breaks on Windows when the user folder has a space. An interactive script (asks for input) avoids it.
- 2026-09-20 (M5): Every test app uses a fake embedding provider. A test that could call the real one would send text out and depend on quota.
- 2026-09-20 (M5): Changing what a status means (Ready now means searchable) touches the seed, the screen, the tests and old data. Old Ready documents get an honest "not searchable yet" instead of a silent change.
- 2026-09-21 (M6): Before building on Qdrant, a throwaway experiment with made-up vectors settled what the docs left open (id types, overwrite on upsert, delete by filter, exact mode, the small-collection full scan). The docs pages were partly missing, so behaviour was checked, not assumed.
- 2026-09-21 (M6): Licences were read from the sources. Two candidates were excluded because their licence was missing or contradictory. "Public" does not mean "free to reuse".
- 2026-09-21 (M6): A document level check ("was the right guide in the top 3?") looked perfect on six questions and hid the real question: is the answer-bearing chunk first? Chunk 1 ranked first every time. Judge retrieval at the level of the answer, which is why questions are judged by quote.
- 2026-09-21 (M6): Two stores cannot share a transaction. Keep one authoritative, write the other last, and provide a check that compares them.
- 2026-09-21 (M6): Wrap errors from a second system so an HTTP status from it is not mistaken for a status from the first.
