import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EXEMPT_MODELS, forWorkspace, scopeArgs, TENANT_MODELS } from "../src/prisma/tenant-client";
import { createTestApp, registerUser, resetDb, type TestContext } from "./helpers";

const A = "workspace-a";

describe("scopeArgs (the rules, without a database)", () => {
  it("filters reads by workspace and keeps the caller's own filter", () => {
    const args = scopeArgs("findMany", { where: { type: "PDF" }, take: 5 }, A);
    expect(args).toEqual({ where: { AND: [{ type: "PDF" }, { workspaceId: A }] }, take: 5 });
  });

  it("filters even when the caller sends no filter at all", () => {
    expect(scopeArgs("findMany", undefined, A)).toEqual({ where: { AND: [{}, { workspaceId: A }] } });
    expect(scopeArgs("count", {}, A)).toEqual({ where: { AND: [{}, { workspaceId: A }] } });
  });

  it("cannot be widened with OR: the workspace condition is ANDed on the outside", () => {
    const args = scopeArgs("findMany", { where: { OR: [{ workspaceId: "other" }, { type: "TXT" }] } }, A);
    expect(args.where).toEqual({ AND: [{ OR: [{ workspaceId: "other" }, { type: "TXT" }] }, { workspaceId: A }] });
  });

  it("scopes unique lookups, so another workspace's id is 'not found'", () => {
    expect(scopeArgs("findUnique", { where: { id: "doc-1" } }, A)).toEqual({ where: { id: "doc-1", workspaceId: A } });
    expect(scopeArgs("delete", { where: { id: "doc-1" } }, A)).toEqual({ where: { id: "doc-1", workspaceId: A } });
  });

  it("overwrites a workspace chosen by the caller on create", () => {
    const args = scopeArgs("create", { data: { originalName: "x.txt", workspaceId: "someone-else" } }, A);
    expect(args.data).toEqual({ originalName: "x.txt", workspaceId: A });
  });

  it("does the same for every row of createMany", () => {
    const args = scopeArgs("createMany", { data: [{ originalName: "1" }, { originalName: "2", workspaceId: "other" }] }, A);
    expect(args.data).toEqual([
      { originalName: "1", workspaceId: A },
      { originalName: "2", workspaceId: A },
    ]);
  });

  it("refuses to move a row to another workspace through update", () => {
    const args = scopeArgs("update", { where: { id: "d" }, data: { originalName: "y", workspaceId: "other" } }, A);
    expect(args.data).toEqual({ originalName: "y" });
    const many = scopeArgs("updateMany", { where: {}, data: { workspaceId: "other", status: "READY" } }, A);
    expect(many.data).toEqual({ status: "READY" });
  });

  it("scopes upsert on all three sides", () => {
    const args = scopeArgs("upsert", { where: { id: "d" }, create: { originalName: "n", workspaceId: "other" }, update: { workspaceId: "other" } }, A);
    expect(args).toEqual({ where: { id: "d", workspaceId: A }, create: { originalName: "n", workspaceId: A }, update: {} });
  });

  it("refuses operations it does not understand instead of letting them through", () => {
    expect(() => scopeArgs("findRaw", {}, A)).toThrow(/not allowed on tenant tables/);
    expect(() => scopeArgs("aggregateRaw", {}, A)).toThrow(/not allowed on tenant tables/);
  });
});

describe("guards against future mistakes", () => {
  it("every schema model with a workspaceId column is registered as tenant data or explicitly exempt", () => {
    const schema = readFileSync(resolve(__dirname, "../prisma/schema.prisma"), "utf8");
    const withWorkspace = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
      .filter(([, , body]) => /^\s+workspaceId\s/m.test(body))
      .map(([, name]) => name.charAt(0).toLowerCase() + name.slice(1));

    expect(withWorkspace.length).toBeGreaterThan(0);
    const known: string[] = [...TENANT_MODELS, ...EXEMPT_MODELS];
    for (const model of withWorkspace) {
      expect(known, `"${model}" has a workspaceId column but is not in TENANT_MODELS or EXEMPT_MODELS`).toContain(model);
    }
  });

  it("the plain database client never touches a tenant table, except in the system queries", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          if (entry !== "generated") walk(path);
        } else if (path.endsWith(".ts")) {
          files.push(path);
        }
      }
    };
    walk(resolve(__dirname, "../src"));

    // "prisma.document" is the plain client. The scoped client is always reached as "db.document" or "tx.document".
    const plain = /\bprisma\.(document|documentPage)\b/;
    const allowed = ["worker/system-queries.ts", "scripts/"]; // the sweeper, and the demo seed which builds both tenants
    const offenders = files.filter((f) => plain.test(readFileSync(f, "utf8")) && !allowed.some((a) => f.replace(/\\/g, "/").includes(a)));
    expect(offenders, `plain client on a tenant table in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("the source contains no raw SQL, which would bypass the workspace filter", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          if (entry !== "generated") walk(path); // the generated Prisma client is not our code
        } else if (path.endsWith(".ts")) {
          files.push(path);
        }
      }
    };
    walk(resolve(__dirname, "../src"));

    const raw = /\$queryRaw|\$executeRaw|\$queryRawUnsafe|\$executeRawUnsafe|Prisma\.sql\b/;
    const offenders = files.filter((f) => raw.test(readFileSync(f, "utf8")));
    expect(files.length).toBeGreaterThan(10);
    expect(offenders, `raw SQL found in: ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("forWorkspace against the real database", () => {
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

  async function twoWorkspacesWithDocuments() {
    const alice = await registerUser(ctx.app, "alice@a.com");
    const bob = await registerUser(ctx.app, "bob@b.com");
    const wa = alice.me.activeWorkspaceId!;
    const wb = bob.me.activeWorkspaceId!;
    const base = { type: "TXT" as const, sizeBytes: 1, storageKey: "k" };
    // Setup goes through the plain client on purpose: tests are allowed to build both tenants.
    const docA = await ctx.prisma.document.create({ data: { ...base, workspaceId: wa, originalName: "a.txt", contentHash: "ha" } });
    const docB = await ctx.prisma.document.create({ data: { ...base, workspaceId: wb, originalName: "b.txt", contentHash: "hb" } });
    return { wa, wb, docA, docB };
  }

  it("reads only the workspace's own rows", async () => {
    const { wa, docA } = await twoWorkspacesWithDocuments();
    const db = forWorkspace(ctx.prisma, wa);
    expect((await db.document.findMany()).map((d) => d.id)).toEqual([docA.id]);
    expect(await db.document.count()).toBe(1);
  });

  it("cannot read, update or delete another workspace's row even with its exact id", async () => {
    const { wa, wb, docB } = await twoWorkspacesWithDocuments();
    const db = forWorkspace(ctx.prisma, wa);

    expect(await db.document.findUnique({ where: { id: docB.id } })).toBeNull();
    await expect(db.document.update({ where: { id: docB.id }, data: { originalName: "hacked" } })).rejects.toThrow();
    await expect(db.document.delete({ where: { id: docB.id } })).rejects.toThrow();
    expect((await db.document.updateMany({ where: { id: docB.id }, data: { originalName: "hacked" } })).count).toBe(0);
    expect((await db.document.deleteMany({ where: { id: docB.id } })).count).toBe(0);

    const untouched = await ctx.prisma.document.findUniqueOrThrow({ where: { id: docB.id } });
    expect(untouched).toMatchObject({ workspaceId: wb, originalName: "b.txt" });
  });

  it("a filter that tries to reach another workspace still returns nothing", async () => {
    const { wa, wb } = await twoWorkspacesWithDocuments();
    const db = forWorkspace(ctx.prisma, wa);
    const rows = await db.document.findMany({ where: { OR: [{ workspaceId: wb }, { originalName: "b.txt" }] } });
    expect(rows).toEqual([]);
  });

  it("creates in the caller's workspace even if the data names another one", async () => {
    const { wa, wb } = await twoWorkspacesWithDocuments();
    const db = forWorkspace(ctx.prisma, wa);
    const created = await db.document.create({
      data: { workspaceId: wb, originalName: "sneaky.txt", type: "TXT", sizeBytes: 1, contentHash: "hs", storageKey: "k2" },
    });
    expect(created.workspaceId).toBe(wa);
  });

  it("deleteMany with no filter deletes only the workspace's own rows", async () => {
    const { wa, docB } = await twoWorkspacesWithDocuments();
    await forWorkspace(ctx.prisma, wa).document.deleteMany({});
    expect(await ctx.prisma.document.count()).toBe(1);
    expect((await ctx.prisma.document.findFirstOrThrow()).id).toBe(docB.id);
  });

  it("scopes the page table the same way: another workspace's pages are invisible and untouchable", async () => {
    const { wa, wb, docA, docB } = await twoWorkspacesWithDocuments();
    await ctx.prisma.documentPage.create({ data: { workspaceId: wa, documentId: docA.id, pageNumber: 1, text: "A page", charCount: 6 } });
    const pageB = await ctx.prisma.documentPage.create({ data: { workspaceId: wb, documentId: docB.id, pageNumber: 1, text: "B page", charCount: 6 } });

    const db = forWorkspace(ctx.prisma, wa);
    expect((await db.documentPage.findMany()).map((p) => p.text)).toEqual(["A page"]);
    expect(await db.documentPage.findUnique({ where: { id: pageB.id } })).toBeNull();
    expect((await db.documentPage.deleteMany({ where: { id: pageB.id } })).count).toBe(0);
    expect(await ctx.prisma.documentPage.count({ where: { workspaceId: wb } })).toBe(1);
  });

  it("scopes the queries inside a transaction too, and a failure rolls everything back", async () => {
    const { wa, wb, docA } = await twoWorkspacesWithDocuments();
    const db = forWorkspace(ctx.prisma, wa);

    // Inside the transaction, a page that names another workspace still lands in the caller's.
    await db.transaction(async (tx) => {
      await tx.documentPage.create({ data: { workspaceId: wb, documentId: docA.id, pageNumber: 1, text: "sneaky", charCount: 6 } });
    });
    const saved = await ctx.prisma.documentPage.findFirstOrThrow({ where: { documentId: docA.id } });
    expect(saved.workspaceId).toBe(wa);

    // A failure part way through leaves nothing behind, not even the first write.
    await expect(
      db.transaction(async (tx) => {
        await tx.documentPage.create({ data: { workspaceId: wa, documentId: docA.id, pageNumber: 2, text: "first write", charCount: 11 } });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await ctx.prisma.documentPage.count({ where: { documentId: docA.id } })).toBe(1);
  });

  it("refuses to be created without a workspace", () => {
    expect(() => forWorkspace(ctx.prisma, "")).toThrow(/needs a workspace id/);
  });
});
