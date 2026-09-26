"use client";

import { ChevronRight, LoaderCircle, MessageCircleQuestion, Square, TriangleAlert } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { AnswerResult, AnswerSource, AnswerUsage, Citation } from "@/lib/types";

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

// What the source panel shows. Opened either from a citation chip (marker known, source resolved from it if
// verified) or from the plain sources list (no marker, just the passage).
type SourcePanel = { source: AnswerSource; marker?: number } | { unverifiedMarker: number };

const CANNOT_REACH = "Could not get an answer. Check your connection and try again.";

/**
 * Ask a question about this workspace's documents (Milestones 7 and 8). Streams the answer over SSE. Citation
 * markers ([N] in the model's own text) become clickable chips once the answer is done, opening a panel with
 * the exact passage highlighted. Markers are plain text while still streaming: citations are only known once
 * the full answer has arrived (see `docs/learning/milestones/M08-citations/concepts.md`).
 */
export function AskView() {
  const [state, setState] = useState<AskState>({ status: "idle" });
  const [panel, setPanel] = useState<SourcePanel | null>(null);
  const esRef = useRef<EventSource | null>(null);

  // Closes any open stream if the person navigates away mid-answer, so nothing keeps running unseen.
  useEffect(() => () => esRef.current?.close(), []);

  function ask(question: string) {
    esRef.current?.close();
    setState({ status: "waiting", question, phase: "retrieving" });
    setPanel(null);

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

  // A verified citation resolves to the real passage it names. An unverified one has no real passage to show
  // (its sourceIndex named nothing that was actually retrieved), so the panel says so instead.
  function openCitation(citation: Citation, sources: AnswerSource[]) {
    const source = citation.verified ? sources[citation.sourceIndex - 1] : undefined;
    setPanel(source ? { source, marker: citation.marker } : { unverifiedMarker: citation.marker });
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
              {state.status === "done" ? (
                <AnswerText text={state.answer} citations={state.citations} onOpenCitation={(c) => openCitation(c, state.sources)} />
              ) : (
                state.answer
              )}
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

            {state.status === "done" && <DoneDetails result={state} onOpenSource={(source) => setPanel({ source })} />}
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

      <Sheet open={panel !== null} onOpenChange={(open) => !open && setPanel(null)}>
        <SheetContent className="flex flex-col gap-0 p-0">
          {panel && "unverifiedMarker" in panel ? (
            <>
              <SheetHeader className="border-b border-border">
                <SheetTitle>Citation {panel.unverifiedMarker}</SheetTitle>
              </SheetHeader>
              <p className="flex items-start gap-2 p-4 text-sm text-warning">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                This citation could not be verified against a passage that was actually searched. It may point to a passage the model invented.
              </p>
            </>
          ) : (
            panel && (
              <>
                <SheetHeader className="border-b border-border">
                  <SheetTitle>{panel.marker ? `Citation ${panel.marker}` : "Source"}</SheetTitle>
                  <SheetDescription>
                    {panel.source.documentName}, page {panel.source.pageNumber}
                  </SheetDescription>
                </SheetHeader>
                <div className="overflow-y-auto p-4">
                  <p className="max-w-[68ch] rounded-md bg-cite p-3 font-serif text-base leading-relaxed text-cite-foreground text-pretty">{panel.source.text}</p>
                  <p className="mt-3 font-mono text-xs tabular-nums text-muted-foreground">similarity score {panel.source.score.toFixed(3)} (not a confidence level)</p>
                </div>
              </>
            )
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Splits the answer's own [N] markers into clickable citation chips. Only called once the full answer has
 * arrived: while still streaming, markers are just characters in the flowing text (see the module doc comment). */
function AnswerText({ text, citations, onOpenCitation }: { text: string; citations: Citation[]; onOpenCitation: (citation: Citation) => void }) {
  if (citations.length === 0) return <>{text}</>;

  const parts: { text: string; citation?: Citation }[] = [];
  let last = 0;
  for (const match of text.matchAll(/\[(\d+)\]/g)) {
    const citation = citations.find((c) => c.marker === Number(match[1]));
    if (!citation || match.index === undefined) continue;
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ text: match[0], citation });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });

  return (
    <>
      {parts.map((part, i) =>
        part.citation ? <CitationChip key={i} citation={part.citation} onOpen={() => onOpenCitation(part.citation!)} /> : <Fragment key={i}>{part.text}</Fragment>,
      )}
    </>
  );
}

function CitationChip({ citation, onOpen }: { citation: Citation; onOpen: () => void }) {
  return (
    <Badge
      asChild
      variant="outline"
      className={cn(
        "mx-0.5 h-[1.15em] min-w-[1.15em] -translate-y-[0.2em] cursor-pointer border px-1 py-0 text-[11px] leading-none",
        citation.verified ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20" : "border-warning/30 bg-warning/10 text-warning hover:bg-warning/20",
      )}
    >
      <button type="button" onClick={onOpen}>
        {citation.marker}
        <span className="sr-only">{citation.verified ? ", open source" : ", this citation could not be verified"}</span>
      </button>
    </Badge>
  );
}

function DoneDetails({ result, onOpenSource }: { result: { noAnswer: boolean; sources: AnswerSource[]; usage: AnswerUsage }; onOpenSource: (source: AnswerSource) => void }) {
  const { noAnswer, sources, usage } = result;
  return (
    <>
      {sources.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-medium">{noAnswer ? "What was searched" : "Sources"}</h2>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {sources.map((s) => (
              <li key={s.chunkId}>
                <button type="button" className="text-left underline-offset-2 hover:text-foreground hover:underline" onClick={() => onOpenSource(s)}>
                  {s.documentName}, page {s.pageNumber}
                </button>
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
