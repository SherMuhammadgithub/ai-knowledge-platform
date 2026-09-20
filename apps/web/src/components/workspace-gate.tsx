"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { type Me, ROLE_LABEL } from "@/lib/types";

// Shown when the workspace in the session is gone (for example the user was removed from it).
// The account is fine, so let the person pick another workspace.
export function WorkspaceGate({ me }: { me: Me }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function open(workspaceId: string) {
    setPendingId(workspaceId);
    try {
      await api("/auth/switch-workspace", { method: "POST", body: { workspaceId } });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not open the workspace. Try again.");
      setPendingId(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">Choose a workspace</h1>
      <p className="mb-6 mt-2 text-muted-foreground">
        You no longer have access to the workspace you were in. Open one of yours to continue.
      </p>
      <ul className="space-y-2">
        {me.workspaces.map((w) => (
          <li key={w.id}>
            <Button
              variant="outline"
              className="h-auto w-full justify-between px-4 py-3"
              disabled={pendingId !== null}
              onClick={() => open(w.id)}
            >
              <span className="truncate font-medium">{w.name}</span>
              <span className="text-xs text-muted-foreground">{ROLE_LABEL[w.role]}</span>
            </Button>
          </li>
        ))}
      </ul>
    </main>
  );
}
