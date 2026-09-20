import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { LoginInput, RegisterInput } from "./auth.schemas";
import { PasswordService } from "./password.service";

export type MeResponse = {
  user: { id: string; email: string; name: string | null };
  workspaces: { id: string; name: string; role: string }[];
  activeWorkspaceId: string | null;
};

const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === "P2002";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  /** Creates the user, a personal workspace, and the owner membership in one transaction. */
  async register(input: RegisterInput): Promise<{ userId: string; workspaceId: string }> {
    const passwordHash = await this.passwords.hash(input.password);
    const workspaceName = `${input.name ?? input.email.split("@")[0]}'s workspace`;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email: input.email, passwordHash, name: input.name ?? null },
        });
        const workspace = await tx.workspace.create({ data: { name: workspaceName } });
        await tx.membership.create({
          data: { userId: user.id, workspaceId: workspace.id, role: "OWNER" },
        });
        return { userId: user.id, workspaceId: workspace.id };
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException("An account with this email already exists");
      throw err;
    }
  }

  async login(input: LoginInput): Promise<{ userId: string; workspaceId: string }> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    // Always run a password check, even for unknown emails (see PasswordService.dummyHash).
    const ok = await this.passwords.verify(user?.passwordHash ?? null, input.password);
    if (!user || !ok) throw new UnauthorizedException("Invalid email or password");

    // Start in the oldest workspace, which is the personal one created at signup.
    const membership = await this.prisma.membership.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: { workspaceId: true },
    });
    if (!membership) throw new ForbiddenException("This account has no workspace");
    return { userId: user.id, workspaceId: membership.workspaceId };
  }

  async me(userId: string, activeWorkspaceId: string | null): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        memberships: {
          orderBy: { createdAt: "asc" },
          select: { role: true, workspace: { select: { id: true, name: true } } },
        },
      },
    });
    if (!user) throw new UnauthorizedException("Sign in to continue");
    return {
      user: { id: user.id, email: user.email, name: user.name },
      workspaces: user.memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name, role: m.role })),
      activeWorkspaceId,
    };
  }

  /** The user may only switch to a workspace they belong to. */
  async assertMember(userId: string, workspaceId: string): Promise<void> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { id: true },
    });
    if (!membership) throw new ForbiddenException("You are not a member of this workspace");
  }
}
