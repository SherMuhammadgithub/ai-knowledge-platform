import type { Metadata } from "next";
import { DocumentsView } from "@/components/documents-view";
import { getDocuments, getMe } from "@/lib/server-api";

export const metadata: Metadata = { title: "Documents" };

export default async function DocumentsPage() {
  const [me, documents] = await Promise.all([getMe(), getDocuments()]);
  const workspace = me?.workspaces.find((w) => w.id === me.activeWorkspaceId);
  if (!me || !workspace) return null; // the layout already handles a missing session or workspace

  return (
    <DocumentsView documents={documents} workspaceName={workspace.name} actorRole={workspace.role} userId={me.user.id} />
  );
}
