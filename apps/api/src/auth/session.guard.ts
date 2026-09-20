import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { WorkspaceRole } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthedRequest } from "./auth.types";
import { IS_PUBLIC, ROLES, USER_ONLY } from "./decorators";
import { SESSION_COOKIE, SessionService } from "./session.service";

/**
 * Global guard, so a new route is protected unless someone explicitly marks it @Public.
 *
 * The workspace in the cookie is only a CLAIM. Every request re-reads the membership row for
 * (user, claimed workspace). A removed member, a changed role, or a forged claim is therefore
 * caught on the very next request, not when the token expires.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly session: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    const claims = typeof token === "string" ? await this.session.verify(token) : null;
    if (!claims) throw new UnauthorizedException("Sign in to continue");

    const membership = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: claims.sub, workspaceId: claims.wid } },
      select: { role: true },
    });

    if (this.reflector.getAllAndOverride<boolean>(USER_ONLY, targets)) {
      const user = await this.prisma.user.findUnique({ where: { id: claims.sub }, select: { id: true } });
      if (!user) throw new UnauthorizedException("Sign in to continue");
      req.auth = {
        userId: user.id,
        workspaceId: membership ? claims.wid : null,
        role: membership?.role ?? null,
      };
      return true;
    }

    if (!membership) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: "You no longer have access to this workspace",
        code: "WORKSPACE_ACCESS_REVOKED",
      });
    }

    const roles = this.reflector.getAllAndOverride<WorkspaceRole[] | undefined>(ROLES, targets);
    if (roles?.length && !roles.includes(membership.role)) {
      throw new ForbiddenException("Your role cannot do this in this workspace");
    }

    req.auth = { userId: claims.sub, workspaceId: claims.wid, role: membership.role };
    return true;
  }
}
