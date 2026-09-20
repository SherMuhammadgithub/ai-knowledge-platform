"use client";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import type { DocumentItem, DocumentPagesResponse } from "@/lib/types";

export type TextViewState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: DocumentPagesResponse };

// Shows what the worker extracted from a file, page by page. This is the text every later step works from,
// so seeing it makes mistakes in extraction (a missing page, a leftover header) easy to spot.
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
            The text read from this file. Later steps work from exactly this text.
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-8">
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
        </div>
      </SheetContent>
    </Sheet>
  );
}
