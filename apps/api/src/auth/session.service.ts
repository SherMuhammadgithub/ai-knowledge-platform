import { Inject, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { CookieOptions, Response } from "express";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import type { SessionClaims } from "./auth.types";

export const SESSION_COOKIE = "akp_session";

@Injectable()
export class SessionService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Signs a session for (user, active workspace) and sets it as an httpOnly cookie. */
  async issue(res: Response, userId: string, workspaceId: string): Promise<void> {
    const claims: SessionClaims = { sub: userId, wid: workspaceId };
    const token = await this.jwt.signAsync(claims);
    res.cookie(SESSION_COOKIE, token, {
      ...this.baseCookieOptions(),
      maxAge: this.env.SESSION_DAYS * 24 * 60 * 60 * 1000,
    });
  }

  clear(res: Response): void {
    res.clearCookie(SESSION_COOKIE, this.baseCookieOptions());
  }

  /** Returns the claims, or null for anything invalid: bad signature, expired, wrong shape. */
  async verify(token: string): Promise<SessionClaims | null> {
    try {
      const payload = await this.jwt.verifyAsync<Partial<SessionClaims>>(token, {
        algorithms: ["HS256"],
      });
      if (typeof payload.sub === "string" && typeof payload.wid === "string") {
        return { sub: payload.sub, wid: payload.wid };
      }
      return null;
    } catch {
      return null;
    }
  }

  private baseCookieOptions(): CookieOptions {
    return {
      httpOnly: true, // not readable from JavaScript, so an XSS bug cannot steal the session
      sameSite: "lax", // not sent on cross-site POSTs (basic CSRF protection)
      secure: this.env.NODE_ENV === "production",
      path: "/",
    };
  }
}
