import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { AuthService } from "../auth/auth.service";
import type { UserAuth, WorkspaceAuth } from "../auth/auth.types";
import { CurrentUser, CurrentWorkspace, Roles, UserOnly } from "../auth/decorators";
import { SessionService } from "../auth/session.service";
import { ZodPipe } from "../common/zod.pipe";
import {
  type AddMemberInput,
  addMemberSchema,
  type CreateWorkspaceInput,
  createWorkspaceSchema,
} from "./workspaces.schemas";
import { WorkspacesService } from "./workspaces.service";

// There is no workspace id in any URL or body here. The workspace is always the caller's active one.
@Controller("workspaces")
export class WorkspacesController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly auth: AuthService,
    private readonly session: SessionService,
  ) {}

  /** Creates a workspace, makes the caller its owner, and switches their session to it. */
  @UserOnly()
  @Post()
  async create(
    @CurrentUser() user: UserAuth,
    @Body(new ZodPipe(createWorkspaceSchema)) body: CreateWorkspaceInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { workspaceId } = await this.workspaces.create(user.userId, body.name);
    await this.session.issue(res, user.userId, workspaceId);
    return this.auth.me(user.userId, workspaceId);
  }

  @Get("current/members")
  listMembers(@CurrentWorkspace() actor: WorkspaceAuth) {
    return this.workspaces.listMembers(actor);
  }

  @Roles("OWNER", "ADMIN")
  @Post("current/members")
  addMember(
    @CurrentWorkspace() actor: WorkspaceAuth,
    @Body(new ZodPipe(addMemberSchema)) body: AddMemberInput,
  ) {
    return this.workspaces.addMember(actor, body);
  }

  @Roles("OWNER", "ADMIN")
  @Delete("current/members/:userId")
  @HttpCode(200)
  removeMember(
    @CurrentWorkspace() actor: WorkspaceAuth,
    @Param("userId", new ParseUUIDPipe()) userId: string,
  ) {
    return this.workspaces.removeMember(actor, userId);
  }
}
