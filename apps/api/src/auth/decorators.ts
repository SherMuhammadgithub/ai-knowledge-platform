import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import type { WorkspaceRole } from "../generated/prisma/client";
import type { AuthedRequest, UserAuth, WorkspaceAuth } from "./auth.types";

export const IS_PUBLIC = "auth:isPublic";
export const USER_ONLY = "auth:userOnly";
export const ROLES = "auth:roles";

// Secure by default: every route needs a session AND membership in the active workspace.
// These opt out or narrow that.
/** No session needed (register, login, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Needs a valid session but not an active workspace (me, switch workspace, create workspace). */
export const UserOnly = () => SetMetadata(USER_ONLY, true);
/** Needs one of these roles in the active workspace. */
export const Roles = (...roles: WorkspaceRole[]) => SetMetadata(ROLES, roles);

const requestAuth = (ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().auth;

/** For @UserOnly routes. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): UserAuth => {
  const auth = requestAuth(ctx);
  if (!auth) throw new UnauthorizedException("Sign in to continue");
  return auth;
});

/** For routes that touch tenant data. The workspace id comes from here, never from the request. */
export const CurrentWorkspace = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): WorkspaceAuth => {
    const auth = requestAuth(ctx);
    if (!auth?.workspaceId || !auth.role) throw new UnauthorizedException("Sign in to continue");
    return { userId: auth.userId, workspaceId: auth.workspaceId, role: auth.role };
  },
);
