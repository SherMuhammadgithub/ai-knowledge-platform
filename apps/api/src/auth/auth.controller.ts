import { Body, Controller, Get, HttpCode, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { ZodPipe } from "../common/zod.pipe";
import {
  type LoginInput,
  loginSchema,
  type RegisterInput,
  registerSchema,
  type SwitchWorkspaceInput,
  switchWorkspaceSchema,
} from "./auth.schemas";
import type { UserAuth } from "./auth.types";
import { AuthService } from "./auth.service";
import { CurrentUser, Public, UserOnly } from "./decorators";
import { SessionService } from "./session.service";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly session: SessionService,
  ) {}

  @Public()
  @Post("register")
  async register(
    @Body(new ZodPipe(registerSchema)) body: RegisterInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { userId, workspaceId } = await this.auth.register(body);
    await this.session.issue(res, userId, workspaceId);
    return this.auth.me(userId, workspaceId);
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginSchema)) body: LoginInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { userId, workspaceId } = await this.auth.login(body);
    await this.session.issue(res, userId, workspaceId);
    return this.auth.me(userId, workspaceId);
  }

  @Public()
  @Post("logout")
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    this.session.clear(res);
  }

  @UserOnly()
  @Get("me")
  me(@CurrentUser() user: UserAuth) {
    return this.auth.me(user.userId, user.workspaceId);
  }

  /** Re-issues the cookie for another workspace, after checking membership. */
  @UserOnly()
  @Post("switch-workspace")
  @HttpCode(200)
  async switchWorkspace(
    @CurrentUser() user: UserAuth,
    @Body(new ZodPipe(switchWorkspaceSchema)) body: SwitchWorkspaceInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.assertMember(user.userId, body.workspaceId);
    await this.session.issue(res, user.userId, body.workspaceId);
    return this.auth.me(user.userId, body.workspaceId);
  }
}
