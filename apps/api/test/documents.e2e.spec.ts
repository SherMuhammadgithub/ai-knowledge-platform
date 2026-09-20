import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { STORAGE, type StorageService } from "../src/storage/storage.service";
import {
  agent,
  createTestApp,
  fixtures,
  registerUser,
  resetDb,
  resetStorage,
  type TestContext,
  upload,
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
  resetStorage(ctx.storageDir);
});

const storage = () => ctx.app.get<StorageService>(STORAGE);
const rowCount = () => ctx.prisma.document.count();
const storedFiles = () => readdirSync(ctx.storageDir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length;

describe("uploading", () => {
  it("accepts a TXT, a PDF and a DOCX, stores the bytes, and records who uploaded them", async () => {
    const { agent: a, me } = await registerUser(ctx.app, "alice@a.com", "Alice");
    const wid = me.activeWorkspaceId!;

    for (const [name, data, type] of [
      ["handbook.txt", fixtures.txt(), "TXT"],
      ["policy.pdf", fixtures.pdf(), "PDF"],
      ["benefits.DOCX", fixtures.docx(), "DOCX"],
    ] as const) {
      const res = await upload(a, data, name);
      expect(res.status, name).toBe(201);
      expect(res.body).toMatchObject({
        name,
        type,
        sizeBytes: data.length,
        status: "UPLOADED",
        uploadedBy: { id: me.user.id, email: "alice@a.com" },
      });
      expect(res.body).not.toHaveProperty("storageKey"); // internal detail, not exposed
      expect(res.body).not.toHaveProperty("contentHash");
      expect((await storage().read(`${wid}/${res.body.id}`)).equals(data)).toBe(true);
    }
    expect(await rowCount()).toBe(3);
  });

  it("lists the workspace's documents, newest first", async () => {
    const { agent: a } = await registerUser(ctx.app, "alice@a.com");
    await upload(a, fixtures.txt("one"), "first.txt");
    await upload(a, fixtures.txt("two"), "second.txt");
    const res = await a.get("/documents");
    expect(res.status).toBe(200);
    expect(res.body.map((d: { name: string }) => d.name)).toEqual(["second.txt", "first.txt"]);
  });
});

describe("refusing bad files", () => {
  async function expectRefused(data: Buffer | null, filename: string, status: number, message?: RegExp) {
    const { agent: a } = await registerUser(ctx.app, `user${Math.random().toString(36).slice(2)}@a.com`);
    const res = data ? await upload(a, data, filename) : await a.post("/documents");
    expect(res.status, `${filename}: ${JSON.stringify(res.body)}`).toBe(status);
    if (message) expect(res.body.message).toMatch(message);
    // A refused file leaves nothing behind: no row, no file.
    expect(await rowCount()).toBe(0);
    expect(storedFiles()).toBe(0);
  }

  it("an executable renamed to .pdf", () => expectRefused(fixtures.exe(), "invoice.pdf", 415, /not a valid PDF/));
  it("plain text renamed to .pdf", () => expectRefused(fixtures.txt(), "notes.pdf", 415, /not a valid PDF/));
  it("a PDF renamed to .docx", () => expectRefused(fixtures.pdf(), "report.docx", 415, /not a valid DOCX/));
  it("binary data named .txt", () => expectRefused(Buffer.from([0, 1, 2, 3, 0, 5]), "data.txt", 415, /not a valid TXT/));
  it("an unsupported extension", () => expectRefused(fixtures.txt(), "photo.png", 415, /Only PDF, DOCX and TXT/));
  it("a file with no extension", () => expectRefused(fixtures.txt(), "README", 415, /Only PDF, DOCX and TXT/));
  it("an empty file", () => expectRefused(Buffer.alloc(0), "empty.txt", 400, /empty/));
  it("a request with no file", () => expectRefused(null, "", 400, /Choose a file/));

  it("a file over the size limit (10 MB) is refused with 413", async () => {
    const tooBig = Buffer.alloc(10 * 1024 * 1024 + 1, "a");
    await expectRefused(tooBig, "huge.txt", 413);
  });
});

describe("duplicates", () => {
  it("the same bytes cannot be uploaded twice to one workspace, even under another name", async () => {
    const { agent: a } = await registerUser(ctx.app, "alice@a.com");
    expect((await upload(a, fixtures.txt("same"), "original.txt")).status).toBe(201);

    const again = await upload(a, fixtures.txt("same"), "renamed.txt");
    expect(again.status).toBe(409);
    expect(again.body.message).toContain("original.txt");
    expect(await rowCount()).toBe(1);
    expect(storedFiles()).toBe(1);
  });

  it("two identical uploads at the same moment produce one document", async () => {
    const { agent: a } = await registerUser(ctx.app, "alice@a.com");
    const results = await Promise.all([upload(a, fixtures.txt("race"), "a.txt"), upload(a, fixtures.txt("race"), "b.txt")]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await rowCount()).toBe(1);
    expect(storedFiles()).toBe(1);
  });

  it("another workspace may hold the same file: nobody can learn what someone else uploaded", async () => {
    const alice = await registerUser(ctx.app, "alice@a.com");
    const bob = await registerUser(ctx.app, "bob@b.com");
    expect((await upload(alice.agent, fixtures.txt("shared"), "x.txt")).status).toBe(201);
    expect((await upload(bob.agent, fixtures.txt("shared"), "x.txt")).status).toBe(201);
    expect(await rowCount()).toBe(2);
  });
});

describe("file names are untrusted text", () => {
  it("a traversal name is shortened to its last part, and the file is stored under our own key", async () => {
    const { agent: a, me } = await registerUser(ctx.app, "alice@a.com");
    const res = await upload(a, fixtures.txt("t"), "../../etc/passwd.txt");
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("passwd.txt");

    // Everything in storage is under <workspaceId>/<documentId>. Nothing escaped the folder.
    expect(readdirSync(ctx.storageDir)).toEqual([me.activeWorkspaceId]);
    expect(existsSync(join(ctx.storageDir, me.activeWorkspaceId!, res.body.id))).toBe(true);
  });

  it("keeps a non-ASCII name intact", async () => {
    const { agent: a } = await registerUser(ctx.app, "alice@a.com");
    const res = await upload(a, fixtures.txt("t"), "résumé 日本語.txt");
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("résumé 日本語.txt");
  });
});

describe("tenant isolation", () => {
  it("another workspace sees none of your documents", async () => {
    const alice = await registerUser(ctx.app, "alice@a.com");
    const bob = await registerUser(ctx.app, "bob@b.com");
    await upload(alice.agent, fixtures.txt("secret plan"), "plan.txt");

    expect((await alice.agent.get("/documents")).body).toHaveLength(1);
    expect((await bob.agent.get("/documents")).body).toEqual([]);
  });

  it("knowing a document's id does not let you delete it from another workspace", async () => {
    const alice = await registerUser(ctx.app, "alice@a.com");
    const bob = await registerUser(ctx.app, "bob@b.com");
    const doc = (await upload(alice.agent, fixtures.txt("secret plan"), "plan.txt")).body;

    const res = await bob.agent.delete(`/documents/${doc.id}`);
    expect(res.status).toBe(404); // not "forbidden": to Bob it does not exist
    expect(await rowCount()).toBe(1);
    expect(await storage().read(`${alice.me.activeWorkspaceId}/${doc.id}`)).toBeInstanceOf(Buffer);
  });

  it("a workspace id sent with the upload is ignored: the document lands in the caller's workspace", async () => {
    const alice = await registerUser(ctx.app, "alice@a.com");
    const bob = await registerUser(ctx.app, "bob@b.com");
    const res = await upload(bob.agent, fixtures.txt("mine"), "mine.txt", {
      workspaceId: alice.me.activeWorkspaceId!,
      workspace_id: alice.me.activeWorkspaceId!,
    });
    expect(res.status).toBe(201);
    const row = await ctx.prisma.document.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.workspaceId).toBe(bob.me.activeWorkspaceId);
  });

  it("requires a session for every route", async () => {
    const anon = agent(ctx.app);
    expect((await anon.get("/documents")).status).toBe(401);
    expect((await upload(anon, fixtures.txt(), "x.txt")).status).toBe(401);
    expect((await anon.delete("/documents/00000000-0000-4000-8000-000000000000")).status).toBe(401);
  });
});

describe("deleting", () => {
  it("removes the row and the file", async () => {
    const { agent: a, me } = await registerUser(ctx.app, "alice@a.com");
    const doc = (await upload(a, fixtures.txt("bye"), "bye.txt")).body;
    expect((await a.delete(`/documents/${doc.id}`)).status).toBe(204);
    expect(await rowCount()).toBe(0);
    await expect(storage().read(`${me.activeWorkspaceId}/${doc.id}`)).rejects.toThrow();
  });

  it("a deleted document can be uploaded again", async () => {
    const { agent: a } = await registerUser(ctx.app, "alice@a.com");
    const first = (await upload(a, fixtures.txt("again"), "a.txt")).body;
    await a.delete(`/documents/${first.id}`);
    expect((await upload(a, fixtures.txt("again"), "a.txt")).status).toBe(201);
  });

  it("an unknown or malformed id gives 404 or 400, not a crash", async () => {
    const { agent: a } = await registerUser(ctx.app, "alice@a.com");
    expect((await a.delete("/documents/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await a.delete("/documents/not-a-uuid")).status).toBe(400);
  });

  describe("who may delete", () => {
    async function workspaceWithPeople() {
      const owner = await registerUser(ctx.app, "owner@w.com", "Owner");
      const wid = owner.me.activeWorkspaceId!;
      const join = async (email: string, role: "ADMIN" | "MEMBER") => {
        const p = await registerUser(ctx.app, email, email);
        await owner.agent.post("/workspaces/current/members").send({ email, role });
        await p.agent.post("/auth/switch-workspace").send({ workspaceId: wid });
        return p;
      };
      return { owner, member: await join("m1@w.com", "MEMBER"), other: await join("m2@w.com", "MEMBER"), admin: await join("admin@w.com", "ADMIN") };
    }

    it("a member can delete their own document but not someone else's", async () => {
      const { member, other } = await workspaceWithPeople();
      const mine = (await upload(member.agent, fixtures.txt("mine"), "mine.txt")).body;
      const theirs = (await upload(other.agent, fixtures.txt("theirs"), "theirs.txt")).body;

      expect((await member.agent.delete(`/documents/${theirs.id}`)).status).toBe(403);
      expect(await rowCount()).toBe(2);
      expect((await member.agent.delete(`/documents/${mine.id}`)).status).toBe(204);
      expect(await rowCount()).toBe(1);
    });

    it("an admin and the owner can delete anyone's document", async () => {
      const { owner, admin, member } = await workspaceWithPeople();
      const one = (await upload(member.agent, fixtures.txt("one"), "one.txt")).body;
      const two = (await upload(member.agent, fixtures.txt("two"), "two.txt")).body;
      expect((await admin.agent.delete(`/documents/${one.id}`)).status).toBe(204);
      expect((await owner.agent.delete(`/documents/${two.id}`)).status).toBe(204);
      expect(await rowCount()).toBe(0);
    });
  });
});
