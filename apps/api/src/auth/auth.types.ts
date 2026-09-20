import type { Request } from "express";
import type { WorkspaceRole } from "../generated/prisma/client";

// What the session cookie carries. Only identity and the active workspace. Roles are NOT in the
// token: the guard reads them from the database on every request so changes apply immediately.
export type SessionClaims = { sub: string; wid: string };

// Set by SessionGuard. workspaceId and role are null only on @UserOnly routes when the user has
// lost access to the workspace named in their cookie.
export type UserAuth = {
  userId: string;
  workspaceId: string | null;
  role: WorkspaceRole | null;
};

// The auth context for any route that touches tenant data. Never null fields.
export type WorkspaceAuth = { userId: string; workspaceId: string; role: WorkspaceRole };

export type AuthedRequest = Request & { auth?: UserAuth };
