import type { Metadata } from "next";
import { MembersTable } from "@/components/members-table";
import { getMe, getMembers } from "@/lib/server-api";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage() {
  const [me, members] = await Promise.all([getMe(), getMembers()]);
  const workspace = me?.workspaces.find((w) => w.id === me.activeWorkspaceId);
  if (!workspace) return null; // the layout already handles a missing workspace

  return <MembersTable members={members} actorRole={workspace.role} workspaceName={workspace.name} />;
}
