"use client";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, ApiError } from "@/lib/api";
import { ROLE_LABEL, type Role } from "@/lib/types";

export function AddMemberDialog({
  open,
  onOpenChange,
  actorRole,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actorRole: Role;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Only owners can create admins (the API enforces this too).
  const roles: ("ADMIN" | "MEMBER")[] = actorRole === "OWNER" ? ["MEMBER", "ADMIN"] : ["MEMBER"];

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return setError("Enter the email they registered with");
    setPending(true);
    setError(null);
    try {
      await api("/workspaces/current/members", { method: "POST", body: { email, role } });
      toast.success("Member added");
      setEmail("");
      setRole("MEMBER");
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add the member. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle>Add member</DialogTitle>
            <DialogDescription>
              They need an account already. Enter the email they registered with.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="member-email">Email</Label>
            <Input
              id="member-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? "member-error" : undefined}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="member-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as "ADMIN" | "MEMBER")}>
              <SelectTrigger id="member-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && (
            <p id="member-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding..." : "Add member"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
