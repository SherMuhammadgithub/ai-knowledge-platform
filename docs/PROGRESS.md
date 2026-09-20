# Progress

**Current milestone:** 5 (Chunking and embeddings), in progress from 2026-09-20. Milestone 4 is closed (browser check passed). Quizzes for Milestones 1 to 4 are unanswered in `docs/learning/QUIZ.md` and do not block anything (M1 question 1 is worth answering before Milestone 5 ends).
**Next action:** Milestone 5 Checkpoint B. The design is in `docs/learning/milestones/M05-chunking-and-embeddings/checkpoint-b-design.md`. Waiting for the user's go, then build the chunk table, the two chunkers, the processor step, the endpoint and the Chunks tab.

## Milestones

- [x] 1. Architecture and setup (quiz parked until M5)
- [x] 2. Auth and workspaces (quiz pending)
- [x] 3. Document upload and storage (quiz pending)
- [x] 4. Processing worker (quiz pending)
- [ ] 5. Chunking and embeddings (in progress, see its folder in `docs/learning/milestones/`)
- [ ] 6. Qdrant retrieval + mini eval
- [ ] 7. Basic RAG
- [ ] 8. Citations
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
