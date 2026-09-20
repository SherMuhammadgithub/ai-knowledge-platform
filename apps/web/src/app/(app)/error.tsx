"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mt-16 flex flex-col items-center text-center">
      <h1 className="text-lg font-semibold">This page could not load</h1>
      <p className="mt-2 max-w-sm text-muted-foreground">
        The server did not respond as expected. Check that the API is running, then try again.
      </p>
      <Button className="mt-6" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
