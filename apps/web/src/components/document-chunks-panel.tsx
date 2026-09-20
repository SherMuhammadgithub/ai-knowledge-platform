"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { DocumentChunksResponse } from "@/lib/types";

export type ChunksViewState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: DocumentChunksResponse };

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

// Shows how the text was cut for search: one block per chunk, in order. Each chunk is embedded on its own,
// so seeing the cuts (and the repeated part at the start of a chunk) makes bad chunking easy to spot.
export function DocumentChunksPanel({ view, onRetry }: { view: ChunksViewState | null; onRetry: () => void }) {
  if (!view || view.state === "loading") {
    return (
      <div aria-busy="true" aria-label="Loading chunks" className="space-y-3">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  if (view.state === "error") {
    return (
      <div className="py-6">
        <p className="text-sm text-destructive">{view.message}</p>
        <Button variant="outline" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  const { chunks } = view.data;
  if (chunks.length === 0) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        This document has no chunks yet. Chunks are made when a document is read.
      </p>
    );
  }

  const pageCount = new Set(chunks.map((c) => c.pageNumber)).size;
  const embeddedCount = chunks.filter((c) => c.embedded).length;
  const averageTokens = Math.round(chunks.reduce((sum, c) => sum + c.tokenEstimate, 0) / chunks.length);

  return (
    <div>
      <p className="text-sm">
        {plural(chunks.length, "chunk", "chunks")}, about {averageTokens.toLocaleString("en")} tokens each.{" "}
        {embeddedCount === chunks.length
          ? "Every chunk has a vector."
          : embeddedCount === 0
            ? "None has a vector yet."
            : `${embeddedCount} of ${chunks.length} have a vector.`}
      </p>
      <p className="mt-1 max-w-[68ch] text-sm text-muted-foreground">
        Each chunk is turned into a vector of numbers on its own, and questions are matched to chunks by comparing vectors. Tinted text at the start of a chunk repeats the end of the
        chunk before it, so a sentence on a boundary is never lost.
      </p>

      <ol className="mt-6 divide-y divide-border">
        {chunks.map((chunk) => {
          const overlap = chunk.overlapWithPrevious;
          return (
            <li key={chunk.chunkIndex} aria-label={`Chunk ${chunk.chunkIndex + 1}`} className="py-5 first:pt-0">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4">
                <h3 className="text-sm font-medium">Chunk {chunk.chunkIndex + 1}</h3>
                <div className="flex gap-4 font-mono text-xs tabular-nums text-muted-foreground">
                  {pageCount > 1 && <span>Page {chunk.pageNumber}</span>}
                  <span>about {chunk.tokenEstimate} tokens</span>
                  <span>{chunk.embedded ? "embedded" : "no vector"}</span>
                </div>
              </div>
              {overlap > 0 && (
                <p className="mb-2 text-xs text-muted-foreground">
                  Starts with {plural(overlap, "character", "characters")} repeated from chunk {chunk.chunkIndex}.
                </p>
              )}
              <p className="max-w-[68ch] whitespace-pre-wrap font-serif text-base leading-relaxed">
                {overlap > 0 && <span className="rounded-sm bg-accent box-decoration-clone">{chunk.text.slice(0, overlap)}</span>}
                {chunk.text.slice(overlap)}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
