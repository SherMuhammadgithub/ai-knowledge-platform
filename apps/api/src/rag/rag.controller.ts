import { Body, Controller, Post, Query, Sse, type MessageEvent } from "@nestjs/common";
import { Observable } from "rxjs";
import type { WorkspaceAuth } from "../auth/auth.types";
import { CurrentWorkspace } from "../auth/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { askSchema, type AskInput } from "./rag.schemas";
import { RagService, type AnswerResult, type AnswerStreamEvent } from "./rag.service";

/**
 * Turns `RagService.answerStream()`'s async generator into the Observable Nest's `@Sse()` needs. A `status`
 * event marks retrieving vs. generating (see `AnswerStreamEvent`); each piece of text becomes a `delta` event;
 * the generator's return value (the same `AnswerResult` the plain endpoint gives) becomes one final `done`
 * event, so the sources and usage arrive once, not with every word.
 */
function toSseObservable(gen: AsyncGenerator<AnswerStreamEvent, AnswerResult>): Observable<MessageEvent> {
  return new Observable<MessageEvent>((subscriber) => {
    let cancelled = false;
    (async () => {
      try {
        for (;;) {
          if (cancelled) return;
          const step = await gen.next();
          if (step.done) {
            subscriber.next({ type: "done", data: step.value });
            subscriber.complete();
            return;
          }
          subscriber.next({ type: step.value.type, data: step.value });
        }
      } catch (err) {
        // Named "failed", not "error": the browser's EventSource reserves the event name "error" for its own
        // connection failures (dispatched with no .data, to the same listener a server-sent "error" event
        // would reach), so reusing it here would make a real failure indistinguishable from a dropped
        // connection. This is a clean SSE event, not an HTTP error: some events may already be on their way to
        // the browser by the time generation fails, so an HTTP-level error response is no longer possible.
        subscriber.next({ type: "failed", data: { message: err instanceof Error ? err.message : String(err) } });
        subscriber.complete();
      }
    })();
    // The browser closed the tab or navigated away: stop reading from the generator, so a still-open retry or
    // provider call is not left running for an answer nobody will see.
    return () => {
      cancelled = true;
      void gen.return?.(undefined as never);
    };
  });
}

// No workspace id in the body or query. The workspace is the caller's active one, from @CurrentWorkspace(), like
// every other tenant-data route.
@Controller("ask")
export class RagController {
  constructor(private readonly rag: RagService) {}

  @Post()
  ask(@CurrentWorkspace() actor: WorkspaceAuth, @Body(new ZodPipe(askSchema)) body: AskInput) {
    return this.rag.answer(actor, body.question);
  }

  // A GET route, not POST: EventSource (the standard browser API for reading an SSE stream) can only open a
  // GET connection, with no way to attach a body. The question goes in the query string instead.
  @Sse("stream")
  askStream(@CurrentWorkspace() actor: WorkspaceAuth, @Query(new ZodPipe(askSchema)) query: AskInput): Observable<MessageEvent> {
    return toSseObservable(this.rag.answerStream(actor, query.question));
  }
}
