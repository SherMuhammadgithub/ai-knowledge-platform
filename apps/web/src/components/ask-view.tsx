"use client";

import { ChevronRight, LoaderCircle, MessageCircleQuestion, Square, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { AnswerResult, AnswerSource, AnswerUsage } from "@/lib/types";

type AskState =
  | { status: "idle" }
  // phase distinguishes retrieval (usually under 2 seconds) from generation (a real Gemini call, anywhere from
  // a few seconds to over a minute in practice). Without it, the page would still say "Searching your
  // documents" long after the search was done, which reads as stuck even when it is not.
  | { status: "waiting"; question: string; phase: "retrieving" | "generating" }
  | { status: "streaming"; question: string; answer: string }
  | { status: "stopped"; question: string; answer: string }
  | { status: "error"; question: string; message: string }
  | ({ status: "done"; question: string; answer: string } & Omit<AnswerResult, "answer">);

const CANNOT_REACH = "Could not get an answer. Check your connection and try again.";

/**
 * Ask a question about this workspace's documents (Milestone 7). Streams the answer over SSE. No citation
 * chips or source-passage panel yet (Milestone 8): sources are a plain list here.
 */
export function AskView() {
  const [state, setState] = useState<AskState>({ status: "idle" });
  const esRef = useRef<EventSource | null>(null);

  // Closes any open stream if the person navigates away mid-answer, so nothing keeps running unseen.
  useEffect(() => () => esRef.current?.close(), []);

  function ask(question: string) {
    esRef.current?.close();
    setState({ status: "waiting", question, phase: "retrieving" });

    const es = new EventSource(`/api/ask/stream?${new URLSearchParams({ question })}`);
    esRef.current = es;

    es.addEventListener("status", (e) => {
      const { status: phase } = JSON.parse((e as MessageEvent).data) as { status: "retrieving" | "generating" };
      setState({ status: "waiting", question, phase });
    });

    es.addEventListener("delta", (e) => {
      const { text } = JSON.parse((e as MessageEvent).data) as { text: string };
      setState((prev) => ({
        status: "streaming",
        question,
        answer: (prev.status === "streaming" ? prev.answer : "") + text,
      }));
    });

    es.addEventListener("done", (e) => {
      const result = JSON.parse((e as MessageEvent).data) as AnswerResult;
      es.close();
      setState({ status: "done", question, ...result });
    });

    // A clean, application-level failure (the model or Qdrant call failed). Named "failed", not "error": the
    // browser's own connection-error handling already owns that name (see rag.controller.ts).
    es.addEventListener("failed", (e) => {
      const { message } = JSON.parse((e as MessageEvent).data) as { message: string };
      es.close();
      setState({ status: "error", question, message });
    });

    // The connection itself dropped (server unreachable, network lost), not an answer that failed. We only
    // reach this if neither "done" nor "failed" closed the stream first.
    es.onerror = () => {
      es.close();
      setState({ status: "error", question, message: CANNOT_REACH });
    };
  }

  function stop() {
    if (state.status !== "streaming") return;
    esRef.current?.close();
    setState({ status: "stopped", question: state.question, answer: state.answer });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const question = new FormData(e.currentTarget).get("question");
    if (typeof question === "string" && question.trim().length >= 3) ask(question.trim());
  }

  const pending = state.status === "waiting" || state.status === "streaming";

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold">Ask</h1>
      <p className="mt-2 text-sm text-muted-foreground">Answers come only from documents in this workspace.</p>

      <form onSubmit={onSubmit} className="mt-6 flex items-end gap-3">
        <div className="flex-1">
          <Label htmlFor="ask-question">Question</Label>
          <Input
            id="ask-question"
            name="question"
            className="mt-1.5"
            placeholder="How much notice do I need to give before taking leave?"
            minLength={3}
            maxLength={1000}
            required
            disabled={pending}
            defaultValue=""
          />
        </div>
        <Button type="submit" disabled={pending}>
          Ask
        </Button>
      </form>

      <div aria-live="polite" className="mt-8">
        {state.status === "waiting" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin text-info" aria-hidden />
            {state.phase === "generating" ? "Getting an answer. This can take a minute or more if the model is busy." : "Searching your documents…"}
          </p>
        )}

        {(state.status === "streaming" || state.status === "stopped" || state.status === "done") && (
          <div>
            <p className="max-w-[68ch] font-serif text-lg leading-relaxed text-pretty">
              {state.answer}
              {state.status === "streaming" && (
                <span className="ml-0.5 inline-block h-[1.1em] w-[0.5ch] translate-y-[0.15em] animate-pulse bg-foreground/70 align-text-bottom" aria-hidden />
              )}
            </p>

            {state.status === "streaming" && (
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={stop}>
                <Square className="size-3" aria-hidden />
                Stop
              </Button>
            )}

            {state.status === "stopped" && <p className="mt-2 text-sm text-muted-foreground">Stopped. The answer above may be incomplete.</p>}

            {state.status === "done" && <DoneDetails result={state} />}
          </div>
        )}

        {state.status === "error" && (
          <div className="max-w-[68ch] rounded-lg border border-border bg-card p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-destructive">
              <TriangleAlert className="size-4" aria-hidden />
              {state.message}
            </p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => ask(state.question)}>
              Try again
            </Button>
          </div>
        )}

        {state.status === "idle" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <MessageCircleQuestion className="size-4" aria-hidden />
            Type a question above to get started.
          </p>
        )}
      </div>
    </div>
  );
}

function DoneDetails({ result }: { result: { noAnswer: boolean; sources: AnswerSource[]; usage: AnswerUsage } }) {
  const { noAnswer, sources, usage } = result;
  return (
    <>
      {sources.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-medium">{noAnswer ? "What was searched" : "Sources"}</h2>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {sources.map((s) => (
              <li key={s.chunkId}>
                {s.documentName}, page {s.pageNumber}
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="mt-6 group/details">
        <summary className={cn("flex w-fit cursor-pointer list-none items-center gap-1 text-sm font-medium text-muted-foreground select-none hover:text-foreground", "[&::-webkit-details-marker]:hidden")}>
          <ChevronRight className="size-3.5 transition-transform group-open/details:rotate-90" aria-hidden />
          Details
        </summary>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <Stat label="Model" value={usage.model} />
          <Stat label="Retrieval" value={`${usage.retrievalMs} ms`} />
          <Stat label="Generation" value={`${usage.generationMs} ms`} />
          <Stat label="Input tokens" value={usage.inputTokens ?? "n/a"} />
          <Stat label="Output tokens" value={usage.outputTokens ?? "n/a"} />
        </dl>
        {sources.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-muted-foreground">Similarity score, closest match first (not a confidence level)</p>
            <ul className="mt-1.5 max-w-sm space-y-1">
              {sources.map((s) => (
                <li key={s.chunkId} className="flex items-baseline justify-between gap-4 text-sm">
                  <span className="truncate text-muted-foreground">{s.documentName}</span>
                  <span className="font-mono tabular-nums">{s.score.toFixed(3)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </details>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}
