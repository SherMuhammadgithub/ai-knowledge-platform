"use client";

import { useEffect, useState } from "react";
import { DocumentChunksPanel, type ChunksViewState } from "@/components/document-chunks-panel";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError } from "@/lib/api";
import type { DocumentChunksResponse, DocumentItem, DocumentPagesResponse } from "@/lib/types";

export type TextViewState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: DocumentPagesResponse };

// Shows what the worker read from a file (Pages) and how that text was cut for search (Chunks). Every later
// step works from these, so seeing them makes mistakes in extraction or chunking easy to spot.
export function DocumentTextSheet({
  document,
  view,
  onClose,
  onRetry,
}: {
  document: DocumentItem | null;
  view: TextViewState | null;
  onClose: () => void;
  onRetry: () => void;
}) {
  return (
    <Sheet open={document !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="truncate pr-8">{document?.name}</SheetTitle>
          <SheetDescription>
            What was read from this file, and how it is cut into chunks for search.
          </SheetDescription>
        </SheetHeader>
        {/* Keyed by document: opening another document starts on the Pages tab with nothing loaded. */}
        <SheetBody key={document?.id ?? "none"} document={document} view={view} onRetry={onRetry} />
      </SheetContent>
    </Sheet>
  );
}

function SheetBody({
  document,
  view,
  onRetry,
}: {
  document: DocumentItem | null;
  view: TextViewState | null;
  onRetry: () => void;
}) {
  const [tab, setTab] = useState("pages");
  // null means "not loaded yet", which the panel shows as a skeleton.
  const [chunks, setChunks] = useState<ChunksViewState | null>(null);
  const documentId = document?.id ?? null;

  // The chunks are fetched the first time the Chunks tab is shown. Try again sets chunks back to null.
  useEffect(() => {
    if (tab !== "chunks" || !documentId || chunks !== null) return;
    let cancelled = false;
    api<DocumentChunksResponse>(`/documents/${documentId}/chunks`)
      .then((data) => !cancelled && setChunks({ state: "ready", data }))
      .catch(
        (err) =>
          !cancelled &&
          setChunks({
            state: "error",
            message: err instanceof ApiError ? err.message : "Could not load the chunks. Try again.",
          }),
      );
    return () => {
      cancelled = true;
    };
  }, [tab, documentId, chunks]);

  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-6 px-4 pb-8">
      <TabsList>
        <TabsTrigger value="pages">Pages</TabsTrigger>
        <TabsTrigger value="chunks">
          Chunks
          {document && document.chunkCount > 0 && (
            <span className="font-mono text-xs tabular-nums text-muted-foreground">{document.chunkCount}</span>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="pages">
        {view?.state === "loading" && (
          <div aria-busy="true" aria-label="Loading text" className="space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}

        {view?.state === "error" && (
          <div className="py-6">
            <p className="text-sm text-destructive">{view.message}</p>
            <Button variant="outline" className="mt-4" onClick={onRetry}>
              Try again
            </Button>
          </div>
        )}

        {view?.state === "ready" && (
          <div className="space-y-8">
            {view.data.pages.map((page) => (
              <section key={page.pageNumber} aria-label={`Page ${page.pageNumber}`}>
                {view.data.pages.length > 1 && (
                  <h3 className="mb-2 text-sm font-medium text-muted-foreground">Page {page.pageNumber}</h3>
                )}
                {page.text ? (
                  <p className="max-w-[68ch] whitespace-pre-wrap font-serif text-base leading-relaxed">{page.text}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">No text on this page.</p>
                )}
              </section>
            ))}
          </div>
        )}
      </TabsContent>

      <TabsContent value="chunks">
        <DocumentChunksPanel view={chunks} onRetry={() => setChunks(null)} />
      </TabsContent>
    </Tabs>
  );
}
