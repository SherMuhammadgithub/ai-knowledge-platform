"use client";

import { Trash2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AddMemberDialog } from "@/components/add-member-dialog";
import { api, ApiError } from "@/lib/api";
import { type Member, ROLE_LABEL, type Role } from "@/lib/types";

// Mirrors the API rules: owners remove anyone but the owner, admins remove plain members only.
function canRemove(actor: Role, target: Member): boolean {
  if (target.role === "OWNER") return false;
  if (actor === "OWNER") return true;
  return actor === "ADMIN" && target.role === "MEMBER";
}

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));

export function MembersTable({
  members,
  actorRole,
  workspaceName,
}: {
  members: Member[];
  actorRole: Role;
  workspaceName: string;
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const canAdd = actorRole === "OWNER" || actorRole === "ADMIN";

  async function confirmRemove() {
    if (!removing) return;
    const target = removing;
    setRemoving(null);
    try {
      await api(`/workspaces/current/members/${target.id}`, { method: "DELETE" });
      toast.success("Member removed");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not remove the member. Try again.");
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Members</h1>
          <p className="mt-1 text-muted-foreground">People who can open {workspaceName}.</p>
        </div>
        {canAdd ? (
          <Button onClick={() => setAddOpen(true)}>
            <UserPlus className="size-4" aria-hidden />
            Add member
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>
                <Button disabled>
                  <UserPlus className="size-4" aria-hidden />
                  Add member
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>Only admins and owners can add members</TooltipContent>
          </Tooltip>
        )}
      </div>

      <p className="mb-3 mt-8 text-sm text-muted-foreground">
        {members.length === 1 ? "1 member" : `${members.length} members`}
      </p>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="hidden sm:table-cell">Joined</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.id} className="group h-14">
                <TableCell>
                  <div className="font-medium">{m.name ?? m.email}</div>
                  {m.name && <div className="text-sm text-muted-foreground">{m.email}</div>}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{ROLE_LABEL[m.role]}</Badge>
                </TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">{formatDate(m.joinedAt)}</TableCell>
                <TableCell>
                  {canRemove(actorRole, m) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100 max-lg:opacity-100"
                      onClick={() => setRemoving(m)}
                      aria-label={`Remove ${m.name ?? m.email}`}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AddMemberDialog open={addOpen} onOpenChange={setAddOpen} actorRole={actorRole} />

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.name ?? removing?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              They lose access to {workspaceName} right away. Their account is not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmRemove}>
              Remove member
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
