"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";

// Re-runs the server checks for the current page, so it recovers as soon as the API is back.
export function RetryButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button className="mt-6" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
      {pending ? "Trying..." : "Try again"}
    </Button>
  );
}
