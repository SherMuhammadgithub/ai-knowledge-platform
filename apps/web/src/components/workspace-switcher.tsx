"use client";

import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { type Me, ROLE_LABEL } from "@/lib/types";

export function WorkspaceSwitcher({ me, onNavigate }: { me: Me; onNavigate?: () => void }) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const active = me.workspaces.find((w) => w.id === me.activeWorkspaceId);

  async function switchTo(workspaceId: string) {
    if (workspaceId === me.activeWorkspaceId) return;
    try {
      await api("/auth/switch-workspace", { method: "POST", body: { workspaceId } });
      onNavigate?.();
      router.push("/");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not switch workspace. Try again.");
    }
  }

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="h-auto w-full justify-between gap-2 px-3 py-2 text-left"
            aria-label="Switch workspace"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{active?.name ?? "Choose a workspace"}</span>
              {active && <span className="block text-xs text-muted-foreground">{ROLE_LABEL[active.role]}</span>}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {me.workspaces.map((w) => (
            <DropdownMenuItem key={w.id} onSelect={() => switchTo(w.id)} className="justify-between gap-2">
              <span className="min-w-0">
                <span className="block truncate">{w.name}</span>
                <span className="block text-xs text-muted-foreground">{ROLE_LABEL[w.role]}</span>
              </span>
              {w.id === me.activeWorkspaceId && <Check className="size-4 shrink-0" aria-label="Current workspace" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden />
            Create workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={onNavigate} />
    </>
  );
}

function CreateWorkspaceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError("Enter a workspace name");
    setPending(true);
    setError(null);
    try {
      await api("/workspaces", { method: "POST", body: { name } });
      toast.success("Workspace created");
      setName("");
      onOpenChange(false);
      onCreated?.();
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the workspace. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle>Create workspace</DialogTitle>
            <DialogDescription>
              A workspace keeps its own documents and members. You become its owner.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="workspace-name">Workspace name</Label>
            <Input
              id="workspace-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? "workspace-name-error" : undefined}
              autoFocus
            />
            {error && (
              <p id="workspace-name-error" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating..." : "Create workspace"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
