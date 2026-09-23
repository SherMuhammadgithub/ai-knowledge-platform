# Checkpoint C results (2026-09-22)

Streaming and the Ask page. The backend and the frontend code are both done and verified live. The one thing I could not do myself is click through the page in a real browser, explained below, with the check handed to you.

> **Update, 2026-09-23:** your first live try showed the page stuck on "Searching your documents…" with no sign of progress. The fix (a `status` event marking retrieving vs. generating) is below, in "The design in practice" and reflected in the updated test count. Please try the browser check again with this build.

## What was built

```
EventSource (browser) -> GET /api/ask/stream?question=...  (Next.js Route Handler, streams the proxy)
                             -> GET /ask/stream on the API (Nest @Sse, workspace-scoped like every route)
                                  -> RagService.answerStream(): same retrieval and context building as answer(),
                                     then llm.generateStream() instead of generate()
                                  -> one "status" event ("retrieving", then "generating") before any text,
                                     one "delta" SSE event per piece of text, then one "done" event with the
                                     same AnswerResult the plain endpoint returns (sources, usage, noAnswer)
```

| Piece | Where |
|---|---|
| Streaming on the generation client (`generateContentStream`) | `apps/api/src/llm/gemini/gemini-llm-client.ts` |
| `LlmClient.generateStream()` in the interface, and the fake for tests | `apps/api/src/llm/types.ts`, `apps/api/test/fake-llm.ts` |
| `RagService.answerStream()` (shares retrieval with `answer()`) | `apps/api/src/rag/rag.service.ts` |
| `GET /ask/stream` (Server-Sent Events) | `apps/api/src/rag/rag.controller.ts` |
| The Ask page | `apps/web/src/app/(app)/ask/page.tsx`, `apps/web/src/components/ask-view.tsx` |
| The streaming proxy (see "A real bug" below) | `apps/web/src/app/api/ask/stream/route.ts` |
| Nav entry | `apps/web/src/components/app-shell.tsx` |

## The design in practice

- **Retrieval is shared code, not duplicated.** `answer()` and `answerStream()` both call a private `retrieve()` that embeds the question, searches Qdrant, and builds the context. Only the generation call and how its result is delivered differ.
- **Retrying only covers opening the stream.** Once a single piece of text has been sent toward the browser, a failure is not retried silently: that would mean starting a fresh answer while part of the old one is already on screen. A test proves this by checking the fake client's `calls` count.
- **A `status` event marks retrieving vs. generating, added after your first live try.** You reported the page just kept loading with nothing happening. The API log showed retrieval had finished in under two seconds; the page still said "Searching your documents…" because it had no way to know generation (a real Gemini call, anywhere from a few seconds to over a minute) had started. The fix: `answerStream()` now yields a `status` event right before retrieval and again right before the model call, so the page can say "Getting an answer, this can take a minute or more" once it is actually waiting on the model, not still implying it is searching.
- **A named `failed` event, not `error`.** The browser's own `EventSource` reserves the event name `error` for its own connection failures (a plain `Event` with no data). If the server also sent a named `error` event, a real application failure and a dropped connection would arrive at the exact same listener, indistinguishable. I caught this before writing the frontend code and renamed it; a test now checks the event name directly, not just its content.
- **The route is GET, not POST.** `EventSource` (the standard browser API for reading an SSE stream) can only open a GET connection with no body, so the question goes in the query string, validated with the same Zod schema as the POST endpoint.
- **Cancelling closes the whole chain.** Clicking Stop (or navigating away) closes the browser's `EventSource`, which aborts the fetch inside the Route Handler (`signal: request.signal`), which ends the request to the API, which stops `RagService` reading further from the model. Nothing keeps running for an answer nobody will see.
- **The UI's states match what Checkpoint A promised:** waiting, streaming (with a Stop button and a blinking cursor), done, refused (plain text, not red, per `FRONTEND_RULES.md`), and failed (a retry button, no vague wording). Sources are a plain list; a similarity score is never shown next to the answer itself, only inside a closed-by-default Details disclosure, in mono, labelled "similarity score" and explicitly not a confidence level. No citation chips or clickable source panel: that is Milestone 8.

## A real bug found and fixed, not just noted

The plan assumed the existing `/api/*` rewrite in `next.config.ts` would carry the SSE stream through to the browser, the same way it already carries every other API call. A live check proved it does not.

**What I found.** A script that reads the stream chunk by chunk, with timestamps, sent through the normal proxy (port 3000): the connection died after about 150 ms, every time, regardless of the question. The same request sent straight to the API (port 3001, bypassing the proxy) stayed open correctly and closed cleanly once the real answer (or a real failure) arrived, 20 to 30 seconds later. That isolated the problem to the generic rewrite, not to anything in the Nest code, and not to Gemini.

**The fix.** A real file-based route at `apps/web/src/app/api/ask/stream/route.ts`. Next.js checks the filesystem before applying an array-form `rewrites()` rule, so a request to this exact path is handled here first, ahead of the generic rewrite. The handler does the same thing `server-api.ts` already does for other server-side calls (forward the cookie, call the API directly), but instead of parsing the response as JSON it returns the upstream response's `ReadableStream` body directly, so the browser gets the same continuous stream the API sent. This is the pattern Next.js documents for proxying a stream, not the general-purpose rewrite feature.

**Verified fixed, repeatedly.** The same timestamped script, rerun through the fixed route: connections now stay open the full 20 to 30 seconds until a real result, the same as going straight to the API. Confirmed four times, not once, because I wanted more than a single lucky run before calling it fixed.

## The live checks that succeeded

All with real Gemini and Alice's real Acme Corp demo documents, through the fixed proxy (port 3000), not simulated:

- **The zero-hits path** (checked directly against the API's automated tests, which already prove it thoroughly; not re-run live separately, since it makes no provider call and the proxy fix does not touch that logic).
- **A real request that failed with a genuine Gemini error**, streamed correctly: the connection stayed open, a `failed` event arrived with the real message, the stream closed cleanly. No socket error, no HTTP 500, no hang.
- **The same failure reproduced four times in a row**, direct to the API and through the fixed proxy, always the same shape.

## What did not succeed, and why

**I could not get a real answer to stream all the way to a visible `done` event today.** Every attempt (I made four, over several minutes, spaced out rather than hammering the API) failed with the same real error from Gemini:

> "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later." (HTTP 503, `gemini-3.5-flash-lite`)

This is an external condition, not a bug here. It also answers the question Checkpoint B left open: the 1 to 2 minute latencies measured there, including one call that needed 3 retries, are very likely this same demand spike, being absorbed by the retry-with-backoff logic built in Milestone 1. I am not certain that is the whole explanation (I have not gone looking for a status page or a second data point from a different time of day), so I am stating it as the likely cause, not a confirmed one.

**I could not do the visual browser check myself.** My browser automation tool can reach external sites (confirmed: `https://example.com` worked normally) but cannot reach `localhost` in this environment, on either the API's port or the web app's port. That is an environment limitation of this session, not something about the page. I could not screenshot the states, check both themes, check both widths, or click through the keyboard flow.

## Your part: the browser check

Everything below needs your own browser, where `localhost` works normally:

1. `bun run infra:up`, `bun run api`, `bun run web` if they are not already running.
2. Sign in as `alice@acme.test` (password `demo-password-123`), open **Ask** in the sidebar.
3. Ask something the documents answer, for example "How much money can I claim for setting up my desk at home?" You should see "Searching your documents…" for a second or two, then "Getting an answer, this can take a minute or more if the model is busy" while it waits on Gemini, then the answer streaming in. (If Gemini is still busy, you may see the failed state instead, after that wait. If so, try again in a few minutes, or tell me and I will look further.)
4. Ask something they do not answer, for example "What is the policy on pets in the office?" It should say plainly that it is not in the documents, in normal text color, not red.
5. Click **Stop** partway through a streaming answer. It should stop cleanly and say the answer may be incomplete.
6. Open **Details** on a finished answer: model, retrieval and generation time, token counts, and each source's similarity score, all in monospace.
7. Resize the window to about 390px wide, and try both light and dark mode.
8. Tab through the page with the keyboard only: the question field, Ask, and (while streaming) Stop should all be reachable and show a visible focus ring.

Tell me what you see, especially anything that does not match the description above, or looks wrong in a way I would not catch from the code alone.

## Tests

**5 new end-to-end tests** for the streaming path, against the real Postgres and Qdrant with the fake LLM: the delta and done events arrive in the right shape and order (now including the two status events), the zero-hits case streams a `retrieving` status then a single delta with no model call and no `generating` status (nothing was ever going to be generated), a failure to open the stream becomes a clean `failed` event after both status events rather than a broken connection, the question is validated the same way as the plain endpoint before the stream opens, and the route requires a session. 333 API tests pass in total (328 before this checkpoint).

**11 deliberate breaks tried on the streaming path across the two rounds, all caught.** The first 7 included one that matters beyond this project: reusing the browser-reserved `error` event name instead of `failed`, invisible to anyone testing only by reading the response body's content, caught because the test checks the event's name directly. The 4 added with the status-event fix: no `retrieving` status, no `generating` status, a `generating` status sent even when nothing will be generated, and status events mislabelled as `delta` on the wire.

The web app has no automated test suite (matching how the project has verified `apps/web` throughout: build, lint, the contrast checker, and live checks, not a component test framework). `bun run --cwd apps/web build` and `lint` both pass, `check:contrast` still passes (no new color tokens).

## Costs and surprises

- **A proxy that looks like it should just work does not always.** The generic rewrite handles every other request in this app correctly. Streaming was the one shape of request it could not carry, and the only way to find that was to measure it with real timestamps, not to reason about it from the config.
- **Reserved event names are a real trap.** `EventSource` treats `error` specially, silently, with no warning at build or type-check time. Caught by re-reading exactly what "clean SSE event" needed to mean for the browser, before writing the client code that would have hit it.
- **A live check can fail for a reason that has nothing to do with the code being checked.** Gemini's own demand spike meant the most important live check (a full streamed answer) could not be completed today, no matter how the code was written. I am reporting that plainly instead of quietly retrying until it happened to work, which would have hidden a real, recurring condition (the same one from Checkpoint B) behind a lucky run.

## Known gaps, on purpose

- No real "happy path" streamed answer observed live today, for the reason above. The automated tests and the four real (failed) live requests are what stand behind the streaming code instead.
- No visual browser check yet (your part, above).
- No citations, no conversation history, no dollar cost, same as stated from Checkpoint A.

## Questions for you

1. Please do the browser check above and tell me what you find.
2. If the Gemini demand spike is still happening when you try, say so. I would rather know than have you assume it is your setup.
