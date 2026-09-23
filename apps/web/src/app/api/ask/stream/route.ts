import { cookies } from "next/headers";

// A real file-based route, not the generic next.config.ts rewrite: Next checks the filesystem before applying
// an array-form rewrite (see that file's comment), so a request to /api/ask/stream lands here first.
//
// Why this exists, and the generic /api/* rewrite is not used for this one path: a live check (2026-09-22)
// found the rewrite proxy closes a long-lived text/event-stream response after about 150ms, well before Gemini
// answers. Going straight to the API (bypassing the proxy) streamed correctly and closed cleanly once the
// provider call finished, tens of seconds later, so the break is in the generic proxy, not in the API's
// streaming route. A Route Handler that explicitly pipes the upstream ReadableStream body through, as below,
// is the documented way to proxy a stream in Next.js and does not show the same problem.
const API_URL = process.env.API_URL ?? "http://localhost:3001";

export async function GET(request: Request) {
  const { search } = new URL(request.url);
  const cookieHeader = (await cookies()).toString();

  const upstream = await fetch(`${API_URL}/ask/stream${search}`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
    // If the browser closes the EventSource (the Stop button, or the tab closing), this request is aborted,
    // which aborts the upstream fetch too, which is what lets RagService stop reading from the model.
    signal: request.signal,
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-cache, no-transform",
    },
  });
}
