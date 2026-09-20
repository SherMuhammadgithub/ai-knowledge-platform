import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  agent,
  createTestApp,
  registerUser,
  resetDb,
  signSession,
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

// Two unrelated companies. Nothing in one may be reachable from the other.
async function twoTenants() {
  const alice = await registerUser(ctx.app, "alice@a.com", "Alice");
  const bob = await registerUser(ctx.app, "bob@b.com", "Bob");
  return {
    alice: { ...alice, wid: alice.me.activeWorkspaceId!, id: alice.me.user.id },
    bob: { ...bob, wid: bob.me.activeWorkspaceId!, id: bob.me.user.id },
  };
}

describe("tenant isolation", () => {
  it("each user only ever sees their own workspace's members", async () => {
    const { alice, bob } = await twoTenants();
    const a = await alice.agent.get("/workspaces/current/members");
    const b = await bob.agent.get("/workspaces/current/members");
    expect(a.body.map((m: { email: string }) => m.email)).toEqual([
      "alice@a.com",
    ]);
    expect(b.body.map((m: { email: string }) => m.email)).toEqual([
      "bob@b.com",
    ]);
  });

  it("a client-supplied workspace id is ignored: it is not an input anywhere", async () => {
    const { alice, bob } = await twoTenants();
    // Try every way a client could name Alice's workspace while signed in as Bob.
    const attempts = [
      () =>
        bob.agent
          .get("/workspaces/current/members")
          .query({ workspaceId: alice.wid }),
      () =>
        bob.agent
          .get("/workspaces/current/members")
          .set("X-Workspace-Id", alice.wid),
      () =>
        bob.agent
          .get("/workspaces/current/members")
          .query({ workspace_id: alice.wid }),
    ];
    for (const attempt of attempts) {
      const res = await attempt();
      expect(res.status).toBe(200);
      expect(res.body.map((m: { email: string }) => m.email)).toEqual([
        "bob@b.com",
      ]);
    }
  });

  it("switching into a workspace you do not belong to is refused and changes nothing", async () => {
    const { alice, bob } = await twoTenants();
    const res = await bob.agent
      .post("/auth/switch-workspace")
      .send({ workspaceId: alice.wid });
    expect(res.status).toBe(403);
    const me = await bob.agent.get("/auth/me");
    expect(me.body.activeWorkspaceId).toBe(bob.wid);
  });

  it("a forged claim is caught: a validly signed token naming someone else's workspace gets nowhere", async () => {
    const { alice, bob } = await twoTenants();
    // The signature is genuine (worst case, e.g. a bug that lets a user pick the claim).
    // The guard still checks the membership row, so the claim alone grants nothing.
    const forged = await signSession(ctx.app, bob.id, alice.wid);
    const res = await agent(ctx.app)
      .get("/workspaces/current/members")
      .set("Cookie", `akp_session=${forged}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("WORKSPACE_ACCESS_REVOKED");
  });

  it("an admin cannot remove a member of another workspace by guessing their user id", async () => {
    const { alice, bob } = await twoTenants();
    const res = await alice.agent.delete(
      `/workspaces/current/members/${bob.id}`,
    );
    expect(res.status).toBe(404);
    const stillThere = await ctx.prisma.membership.count({
      where: { userId: bob.id, workspaceId: bob.wid },
    });
    expect(stillThere).toBe(1);
  });
});

describe("membership changes apply immediately", () => {
  it("a removed member loses access on their very next request, not when the token expires", async () => {
    const { alice } = await twoTenants();
    const carol = await registerUser(ctx.app, "carol@c.com", "Carol");

    // Alice adds Carol; Carol switches into Alice's workspace and can read it.
    expect(
      (
        await alice.agent
          .post("/workspaces/current/members")
          .send({ email: "carol@c.com", role: "MEMBER" })
      ).status,
    ).toBe(201);
    await carol.agent
      .post("/auth/switch-workspace")
      .send({ workspaceId: alice.wid });
    expect((await carol.agent.get("/workspaces/current/members")).status).toBe(
      200,
    );

    // Alice removes Carol. Carol's cookie is still validly signed and unexpired.
    expect(
      (
        await alice.agent.delete(
          `/workspaces/current/members/${carol.me.user.id}`,
        )
      ).status,
    ).toBe(200);

    const after = await carol.agent.get("/workspaces/current/members");
    expect(after.status).toBe(401);
    expect(after.body.code).toBe("WORKSPACE_ACCESS_REVOKED");

    // She can still sign in and see her own account and workspaces, so the UI can recover.
    const me = await carol.agent.get("/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.activeWorkspaceId).toBeNull();
    expect(me.body.workspaces.map((w: { id: string }) => w.id)).toEqual([
      carol.me.activeWorkspaceId,
    ]);
  });
});

describe("roles", () => {
  async function workspaceWith(
    members: { email: string; role: "ADMIN" | "MEMBER" }[],
  ) {
    const owner = await registerUser(ctx.app, "owner@w.com", "Owner");
    const wid = owner.me.activeWorkspaceId!;
    const people: Record<string, Awaited<ReturnType<typeof registerUser>>> = {};
    for (const m of members) {
      const p = await registerUser(ctx.app, m.email, m.email);
      await owner.agent.post("/workspaces/current/members").send(m);
      await p.agent.post("/auth/switch-workspace").send({ workspaceId: wid });
      people[m.email] = p;
    }
    return { owner, wid, people };
  }

  it("a plain member can read but cannot add or remove people", async () => {
    const { owner, people } = await workspaceWith([
      { email: "m@w.com", role: "MEMBER" },
    ]);
    await registerUser(ctx.app, "new@w.com");
    const m = people["m@w.com"].agent;
    expect((await m.get("/workspaces/current/members")).status).toBe(200);
    expect(
      (
        await m
          .post("/workspaces/current/members")
          .send({ email: "new@w.com", role: "MEMBER" })
      ).status,
    ).toBe(403);
    expect(
      (await m.delete(`/workspaces/current/members/${owner.me.user.id}`))
        .status,
    ).toBe(403);
  });

  it("an admin can add members but not admins, and cannot remove other admins", async () => {
    const { people } = await workspaceWith([
      { email: "admin1@w.com", role: "ADMIN" },
      { email: "admin2@w.com", role: "ADMIN" },
    ]);
    await registerUser(ctx.app, "new@w.com");
    const admin = people["admin1@w.com"].agent;
    expect(
      (
        await admin
          .post("/workspaces/current/members")
          .send({ email: "new@w.com", role: "ADMIN" })
      ).status,
    ).toBe(403);
    expect(
      (
        await admin
          .post("/workspaces/current/members")
          .send({ email: "new@w.com", role: "MEMBER" })
      ).status,
    ).toBe(201);
    expect(
      (
        await admin.delete(
          `/workspaces/current/members/${people["admin2@w.com"].me.user.id}`,
        )
      ).status,
    ).toBe(403);
  });

  it("the owner can add admins, and nobody can remove the owner", async () => {
    const { owner, people } = await workspaceWith([
      { email: "admin@w.com", role: "ADMIN" },
    ]);
    await registerUser(ctx.app, "new@w.com");
    expect(
      (
        await owner.agent
          .post("/workspaces/current/members")
          .send({ email: "new@w.com", role: "ADMIN" })
      ).status,
    ).toBe(201);
    const res = await people["admin@w.com"].agent.delete(
      `/workspaces/current/members/${owner.me.user.id}`,
    );
    expect(res.status).toBe(403);
  });

  it("OWNER cannot be granted through the API", async () => {
    const { owner } = await workspaceWith([]);
    await registerUser(ctx.app, "new@w.com");
    const res = await owner.agent
      .post("/workspaces/current/members")
      .send({ email: "new@w.com", role: "OWNER" });
    expect(res.status).toBe(400);
  });
});

describe("workspaces", () => {
  it("creating a second workspace makes you its owner and switches your session to it", async () => {
    const { agent: a, me } = await registerUser(ctx.app, "multi@example.com");
    const res = await a.post("/workspaces").send({ name: "Second team" });
    expect(res.status).toBe(201);
    expect(res.body.workspaces).toHaveLength(2);
    expect(res.body.activeWorkspaceId).not.toBe(me.activeWorkspaceId);
    const created = res.body.workspaces.find(
      (w: { id: string }) => w.id === res.body.activeWorkspaceId,
    );
    expect(created).toMatchObject({ name: "Second team", role: "OWNER" });
  });
});
