import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { WorkspaceAuth } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import type { AddMemberInput } from "./workspaces.schemas";

const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === "P2002";

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, name: string): Promise<{ workspaceId: string }> {
    const workspace = await this.prisma.workspace.create({
      data: { name, memberships: { create: { userId, role: "OWNER" } } },
      select: { id: true },
    });
    return { workspaceId: workspace.id };
  }

  // Every query below filters on actor.workspaceId, which comes from the guard, not the request.
  async listMembers(actor: WorkspaceAuth) {
    const rows = await this.prisma.membership.findMany({
      where: { workspaceId: actor.workspaceId },
      orderBy: { createdAt: "asc" },
      select: { role: true, createdAt: true, user: { select: { id: true, email: true, name: true } } },
    });
    return rows.map((m) => ({ ...m.user, role: m.role, joinedAt: m.createdAt }));
  }

  async addMember(actor: WorkspaceAuth, input: AddMemberInput) {
    // Only owners can create admins. Admins can add plain members.
    if (input.role === "ADMIN" && actor.role !== "OWNER") {
      throw new ForbiddenException("Only the workspace owner can add admins");
    }
    const target = await this.prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
    if (!target) throw new NotFoundException("No account has this email. They need to register first");
    try {
      await this.prisma.membership.create({
        data: { userId: target.id, workspaceId: actor.workspaceId, role: input.role },
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException("This person is already a member");
      throw err;
    }
    return this.listMembers(actor);
  }

  async removeMember(actor: WorkspaceAuth, targetUserId: string) {
    // The workspace id in this lookup is the actor's, so a user id from another workspace is a 404.
    const target = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: targetUserId, workspaceId: actor.workspaceId } },
      select: { id: true, role: true },
    });
    if (!target) throw new NotFoundException("This person is not a member of the workspace");
    if (target.role === "OWNER") throw new ForbiddenException("The owner cannot be removed");
    if (target.role === "ADMIN" && actor.role !== "OWNER") {
      throw new ForbiddenException("Only the workspace owner can remove admins");
    }
    await this.prisma.membership.delete({ where: { id: target.id } });
    return this.listMembers(actor);
  }
}
