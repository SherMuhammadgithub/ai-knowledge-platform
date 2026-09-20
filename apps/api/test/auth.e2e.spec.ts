import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JwtService } from "@nestjs/jwt";
import {
  agent,
  createTestApp,
  PASSWORD,
  registerUser,
  resetDb,
  type TestContext,
} from "./helpers";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await resetDb(ctx.prisma);
});

describe("register", () => {
  it("creates a user, a personal workspace owned by them, and an httpOnly session cookie", async () => {
    const res = await agent(ctx.app)
      .post("/auth/register")
      .send({ email: "Ada@Example.com", password: PASSWORD, name: "Ada" });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("ada@example.com"); // normalised to lowercase
    expect(res.body.workspaces).toHaveLength(1);
    expect(res.body.workspaces[0].role).toBe("OWNER");
    expect(res.body.activeWorkspaceId).toBe(res.body.workspaces[0].id);

    const cookie = (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("akp_session="));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it("never returns or stores the password in plain text", async () => {
    const res = await agent(ctx.app).post("/auth/register").send({ email: "a@example.com", password: PASSWORD });
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash/i);

    const stored = await ctx.prisma.user.findUniqueOrThrow({ where: { email: "a@example.com" } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.passwordHash).not.toContain(PASSWORD);
  });

  it("rejects a second account with the same email, ignoring case", async () => {
    await registerUser(ctx.app, "same@example.com");
    const res = await agent(ctx.app).post("/auth/register").send({ email: "SAME@example.com", password: PASSWORD });
    expect(res.status).toBe(409);
  });

  it("rejects a short password and a bad email with a message per field", async () => {
    const res = await agent(ctx.app).post("/auth/register").send({ email: "nope", password: "short" });
    expect(res.status).toBe(400);
    const fields = (res.body.issues as { field: string }[]).map((i) => i.field).sort();
    expect(fields).toEqual(["email", "password"]);
  });
});

describe("login", () => {
  it("signs in with the right password", async () => {
    await registerUser(ctx.app, "login@example.com");
    const res = await agent(ctx.app).post("/auth/login").send({ email: "LOGIN@example.com", password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("login@example.com");
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    await registerUser(ctx.app, "known@example.com");
    const wrongPassword = await agent(ctx.app).post("/auth/login").send({ email: "known@example.com", password: "wrong-password" });
    const unknownEmail = await agent(ctx.app).post("/auth/login").send({ email: "ghost@example.com", password: "wrong-password" });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
  });
});

describe("session", () => {
  it("blocks every protected route without a cookie", async () => {
    for (const path of ["/auth/me", "/workspaces/current/members"]) {
      const res = await agent(ctx.app).get(path);
      expect(res.status, path).toBe(401);
    }
  });

  it("keeps the health check public", async () => {
    expect((await agent(ctx.app).get("/health")).status).toBe(200);
  });

  it("rejects a tampered token and a token signed with another secret", async () => {
    const { me } = await registerUser(ctx.app, "t@example.com");
    const forged = await new JwtService({ secret: "some-other-secret-some-other-secret-1" }).signAsync({
      sub: me.user.id,
      wid: me.activeWorkspaceId,
    });
    const res = await agent(ctx.app).get("/auth/me").set("Cookie", `akp_session=${forged}`);
    expect(res.status).toBe(401);

    const garbage = await agent(ctx.app).get("/auth/me").set("Cookie", "akp_session=not-a-jwt");
    expect(garbage.status).toBe(401);
  });

  it("logout clears the cookie and the session stops working", async () => {
    const { agent: a } = await registerUser(ctx.app, "out@example.com");
    expect((await a.get("/auth/me")).status).toBe(200);
    const out = await a.post("/auth/logout");
    expect(out.status).toBe(204);
    expect((await a.get("/auth/me")).status).toBe(401);
  });
});
