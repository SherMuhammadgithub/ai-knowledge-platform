import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ServiceUnavailable } from "@/components/service-unavailable";
import { WorkspaceGate } from "@/components/workspace-gate";
import { getSession } from "@/lib/server-api";

// Every page in this group needs a session. The API is the real gatekeeper for data,
// this layout only decides what to show.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session.state === "unavailable") return <ServiceUnavailable />;
  if (session.state === "signed-out") redirect("/login");

  const { me } = session;
  if (!me.activeWorkspaceId) return <WorkspaceGate me={me} />;
  return <AppShell me={me}>{children}</AppShell>;
}
