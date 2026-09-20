import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE, type StorageService } from "../src/storage/storage.service";
import { createDocumentWorker } from "../src/worker/document.worker";
import { SweeperService } from "../src/worker/sweeper.service";
import { SystemQueries } from "../src/worker/system-queries";
import { blankPdf, handbookPdf, makeDocx, makePdf } from "./file-builders";
import {
  createTestApp,
  fixtures,
  registerUser,
  resetDb,
  resetStorage,
  TEST_QUEUE_PREFIX,
  type TestContext,
  upload,
  waitFor,
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
  await ctx.queue.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const storage = () => ctx.app.get<StorageService>(STORAGE);

/** Creates a document row and its file directly, the way an upload would leave them. */
async function storeDocument(workspaceId: string, type: "PDF" | "DOCX" | "TXT", bytes: Buffer, name = `file.${type.toLowerCase()}`, uploadedById: string | null = null) {
  const id = randomUUID();
  const storageKey = `${workspaceId}/${id}`;
  await storage().put(storageKey, bytes);
  await ctx.prisma.document.create({
    data: {
      id,
      workspaceId,
      uploadedById,
      originalName: name,
      type,
      sizeBytes: bytes.length,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      storageKey,
    },
  });
  return id;
}

const documentRow = (id: string) => ctx.prisma.document.findUniqueOrThrow({ where: { id } });
const pagesOf = (id: string) => ctx.prisma.documentPage.findMany({ where: { documentId: id }, orderBy: { pageNumber: "asc" } });

async function aliceWorkspace() {
  const alice = await registerUser(ctx.app, "alice@a.com", "Alice");
  return { ...alice, wid: alice.me.activeWorkspaceId!, userId: alice.me.user.id };
}

describe("DocumentProcessorService: one document at a time", () => {
  it("turns a PDF into Ready with its pages, without the header and footer", async () => {
    const { wid } = await aliceWorkspace();
    const id = await storeDocument(wid, "PDF", await handbookPdf(), "handbook.pdf");

    expect(await ctx.processor.process({ documentId: id, workspaceId: wid })).toBe("ready");

    const doc = await documentRow(id);
    expect(doc).toMatchObject({ status: "READY", statusDetail: null, pageCount: 3 });
    expect(doc.processedAt).toBeInstanceOf(Date);
    const pages = await pagesOf(id);
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
    expect(pages[0].text).toContain("25 days of paid annual leave per calendar year.");
    expect(pages[0].text).toContain("first quarter of the next year.");
    expect(pages.map((p) => p.text).join("\n")).not.toMatch(/Confidential|Page \d of 3/);
    expect(doc.charCount).toBe(pages.reduce((n, p) => n + p.charCount, 0));
    expect(pages.every((p) => p.workspaceId === wid)).toBe(true);
  });

  it("reads a Word file and a text file as a single page each", async () => {
    const { wid } = await aliceWorkspace();
    const docx = await storeDocument(wid, "DOCX", makeDocx(["Remote work guidelines", "Up to three days a week with a manager's agreement."]));
    const txt = await storeDocument(wid, "TXT", fixtures.txt("Full-time employees get 25 days of paid annual leave."));
    expect(await ctx.processor.process({ documentId: docx, workspaceId: wid })).toBe("ready");
    expect(await ctx.processor.process({ documentId: txt, workspaceId: wid })).toBe("ready");
    expect((await pagesOf(docx))).toHaveLength(1);
    expect((await pagesOf(txt))[0].text).toBe("Full-time employees get 25 days of paid annual leave.");
  });

  it("is safe to run twice: a repeat delivery does not change anything", async () => {
    const { wid } = await aliceWorkspace();
    const id = await storeDocument(wid, "PDF", await handbookPdf());
    expect(await ctx.processor.process({ documentId: id, workspaceId: wid })).toBe("ready");
    const before = await pagesOf(id);

    expect(await ctx.processor.process({ documentId: id, workspaceId: wid })).toBe("skipped");
    expect((await pagesOf(id)).map((p) => p.id)).toEqual(before.map((p) => p.id));
  });

  it("replaces earlier pages instead of adding to them (a run that crashed half way, then a retry)", async () => {
    const { wid } = await aliceWorkspace();
    const id = await storeDocument(wid, "PDF", await handbookPdf());
    // Leftovers of an earlier, interrupted run: two stale pages and a Processing status.
    await ctx.prisma.documentPage.createMany({
      data: [1, 2].map((n) => ({ workspaceId: wid, documentId: id, pageNumber: n, text: `stale ${n}`, charCount: 7 })),
    });
    await ctx.prisma.document.update({ where: { id }, data: { status: "PROCESSING" } });

    expect(await ctx.processor.process({ documentId: id, workspaceId: wid })).toBe("ready");
    const pages = await pagesOf(id);
    expect(pages).toHaveLength(3);
    expect(pages.some((p) => p.text.startsWith("stale"))).toBe(false);
  });

  it("marks a PDF with no text as Failed, with a reason a person can act on", async () => {
    const { wid } = await aliceWorkspace();
    const id = await storeDocument(wid, "PDF", await blankPdf());
    expect(await ctx.processor.process({ documentId: id, workspaceId: wid })).toBe("failed");
    const doc = await documentRow(id);
    expect(doc.status).toBe("FAILED");
    expect(doc.statusDetail).toMatch(/no readable text.*scan/i);
    expect(await pagesOf(id)).toHaveLength(0);
  });

  it("marks a damaged PDF as Failed at once, without retrying (retrying cannot help)", async () => {
    const { wid } = await aliceWorkspace();
    const id = await storeDocument(wid, "PDF", Buffer.from("%PDF-1.4\nnot really a pdf at all"));
    // First attempt of three, and it still does not throw: a problem with the file is final.
    expect(await ctx.processor.process({ documentId: id, workspaceId: wid }, { number: 1, max: 3 })).toBe("failed");
    expect((await documentRow(id)).statusDetail).toMatch(/could not be read/);
  });

  it("marks a document Failed when its file is missing from storage", async () => {
    const { wid } = await aliceWorkspace();
    const id = await storeDocument(wid, "TXT", fixtures.txt("some text that is long enough"));
    await storage().delete(`${wid}/${id}`);
    expect(await ctx.processor.process({ documentId: id, workspaceId: wid })).toBe("failed");
    expect((await documentRow(id)).statusDetail).toMatch(/stored file is missing/);
  });

  it("does nothing for a document that was deleted while it waited in the queue", async () => {
    const { wid } = await aliceWorkspace();
    const id = await storeDocument(wid, "TXT", fixtures.txt("some text that is long enough"));
    await ctx.prisma.document.delete({ where: { id } });
    expect(await ctx.processor.process({ documentId: id, workspaceId: wid })).toBe("skipped");
  });

  it("a job naming the wrong workspace finds nothing and touches nothing", async () => {
    const alice = await aliceWorkspace();
    const bob = await registerUser(ctx.app, "bob@b.com", "Bob");
    const id = await storeDocument(alice.wid, "TXT", fixtures.txt("Alice's private planning notes for next year."));

    expect(await ctx.processor.process({ documentId: id, workspaceId: bob.me.activeWorkspaceId! })).toBe("skipped");

    const doc = await documentRow(id);
    expect(doc.status).toBe("UPLOADED");
    expect(await pagesOf(id)).toHaveLength(0);
  });

  describe("temporary problems", () => {
    it("are thrown so the queue retries, until the last attempt, which gives up with a plain reason", async () => {
      const { wid } = await aliceWorkspace();
      const id = await storeDocument(wid, "TXT", fixtures.txt("some text that is long enough"));
      vi.spyOn(storage(), "read").mockRejectedValue(new Error("disk hiccup"));

      await expect(ctx.processor.process({ documentId: id, workspaceId: wid }, { number: 1, max: 3 })).rejects.toThrow("disk hiccup");
      expect((await documentRow(id)).status).toBe("PROCESSING"); // still in progress, another attempt will follow

      expect(await ctx.processor.process({ documentId: id, workspaceId: wid }, { number: 3, max: 3 })).toBe("failed");
      const doc = await documentRow(id);
      expect(doc.status).toBe("FAILED");
      expect(doc.statusDetail).toMatch(/temporary problem/);
    });

    it("succeed on a later attempt when the problem goes away", async () => {
      const { wid } = await aliceWorkspace();
      const id = await storeDocument(wid, "TXT", fixtures.txt("some text that is long enough"));
      const read = vi.spyOn(storage(), "read");
      read.mockRejectedValueOnce(new Error("disk hiccup"));

      await expect(ctx.processor.process({ documentId: id, workspaceId: wid }, { number: 1, max: 3 })).rejects.toThrow();
      expect(await ctx.processor.process({ documentId: id, workspaceId: wid }, { number: 2, max: 3 })).toBe("ready");
    });
  });
});

describe("through the queue and a real worker", () => {
  let running: ReturnType<typeof createDocumentWorker> | undefined;
  afterEach(async () => {
    await running?.close();
    running = undefined;
  });
  const startWorker = () => {
    running = createDocumentWorker({
      processor: ctx.processor,
      redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
      prefix: TEST_QUEUE_PREFIX,
      concurrency: 1,
      timeoutSeconds: 60,
    });
  };

  const statusOf = async (agent: { get: (p: string) => PromiseLike<{ body: any }> }, id: string) => {
    const list = (await agent.get("/documents")).body as { id: string; status: string }[];
    return list.find((d) => d.id === id);
  };
  const waitForStatus = (agent: { get: (p: string) => PromiseLike<{ body: any }> }, id: string, status: string) =>
    waitFor(async () => {
      const d = await statusOf(agent, id);
      return d?.status === status ? d : false;
    });

  it("an uploaded PDF goes from Uploaded to Ready by itself, and its text can be read", async () => {
    const { agent: a } = await aliceWorkspace();
    startWorker();

    const res = await upload(a, await handbookPdf(), "handbook.pdf");
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("UPLOADED"); // the upload returns before any reading happens

    const ready = await waitForStatus(a, res.body.id, "READY");
    expect(ready).toMatchObject({ pageCount: 3, statusDetail: null });

    const pages = await a.get(`/documents/${res.body.id}/pages`);
    expect(pages.status).toBe(200);
    expect(pages.body.document.status).toBe("READY");
    expect(pages.body.pages.map((p: { pageNumber: number }) => p.pageNumber)).toEqual([1, 2, 3]);
    expect(pages.body.pages[0].text).toContain("first quarter of the next year.");
  });

  it("a PDF with no text ends as Failed with its reason, and Retry runs it again", async () => {
    const { agent: a } = await aliceWorkspace();
    startWorker();

    const res = await upload(a, await blankPdf(), "scan.pdf");
    const failed = await waitForStatus(a, res.body.id, "FAILED");
    expect(failed).toMatchObject({ statusDetail: expect.stringMatching(/no readable text/) });

    const retry = await a.post(`/documents/${res.body.id}/retry`);
    expect(retry.status).toBe(200);
    expect(retry.body.status).toBe("UPLOADED");
    expect(retry.body.statusDetail).toBeNull();
    await waitForStatus(a, res.body.id, "FAILED"); // still no text, so it fails again
  });

  it("only a failed document can be retried", async () => {
    const { agent: a } = await aliceWorkspace();
    startWorker();
    const res = await upload(a, fixtures.txt("A short note that has enough characters."), "note.txt");
    await waitForStatus(a, res.body.id, "READY");
    expect((await a.post(`/documents/${res.body.id}/retry`)).status).toBe(409);
  });

  it("retry follows the delete rules: your own upload yes, someone else's no, another workspace never", async () => {
    const owner = await registerUser(ctx.app, "owner@w.com", "Owner");
    const wid = owner.me.activeWorkspaceId!;
    const member = await registerUser(ctx.app, "m1@w.com", "M1");
    const other = await registerUser(ctx.app, "m2@w.com", "M2");
    for (const [p, email] of [[member, "m1@w.com"], [other, "m2@w.com"]] as const) {
      await owner.agent.post("/workspaces/current/members").send({ email, role: "MEMBER" });
      await p.agent.post("/auth/switch-workspace").send({ workspaceId: wid });
    }
    const outsider = await registerUser(ctx.app, "out@x.com", "Out");

    // Different page counts make different files: the same bytes cannot be stored twice in one workspace.
    const failedDoc = async (uploader: typeof member, name: string, pages: number) => {
      const id = await storeDocument(wid, "PDF", await makePdf(Array.from({ length: pages }, () => [])), name, uploader.me.user.id);
      await ctx.prisma.document.update({ where: { id }, data: { status: "FAILED", statusDetail: "No text" } });
      return id;
    };
    const mine = await failedDoc(member, "mine.pdf", 2);
    const theirs = await failedDoc(other, "theirs.pdf", 3);

    expect((await other.agent.post(`/documents/${mine}/retry`)).status).toBe(403);
    expect((await outsider.agent.post(`/documents/${mine}/retry`)).status).toBe(404);
    expect((await member.agent.post(`/documents/${mine}/retry`)).status).toBe(200);
    expect((await owner.agent.post(`/documents/${theirs}/retry`)).status).toBe(200);
  });

  it("the extracted text is only visible inside the workspace", async () => {
    const alice = await aliceWorkspace();
    const bob = await registerUser(ctx.app, "bob@b.com", "Bob");
    const id = await storeDocument(alice.wid, "TXT", fixtures.txt("Alice's private planning notes for next year."), "plan.txt", alice.userId);
    await ctx.processor.process({ documentId: id, workspaceId: alice.wid });

    expect((await alice.agent.get(`/documents/${id}/pages`)).status).toBe(200);
    expect((await bob.agent.get(`/documents/${id}/pages`)).status).toBe(404);
  });

  it("a failure to queue does not undo the upload", async () => {
    const { agent: a } = await aliceWorkspace();
    vi.spyOn(ctx.queue, "enqueue").mockRejectedValue(new Error("redis is down"));
    const res = await upload(a, fixtures.txt("A short note that has enough characters."), "note.txt");
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("UPLOADED");
  });
});

describe("the sweeper rescues documents nobody is working on", () => {
  let running: ReturnType<typeof createDocumentWorker> | undefined;
  afterEach(async () => {
    await running?.close();
    running = undefined;
  });

  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

  it("queues a document that stayed Uploaded or Processing for over 5 minutes, and only that", async () => {
    const { wid } = await aliceWorkspace();
    const neverQueued = await storeDocument(wid, "TXT", fixtures.txt("A note that was never queued, long enough."), "a.txt");
    const workerDied = await storeDocument(wid, "TXT", fixtures.txt("A note whose worker died, long enough."), "b.txt");
    const fresh = await storeDocument(wid, "TXT", fixtures.txt("A note uploaded just now, long enough."), "c.txt");
    await ctx.prisma.document.update({ where: { id: neverQueued }, data: { updatedAt: minutesAgo(10) } });
    await ctx.prisma.document.update({ where: { id: workerDied }, data: { status: "PROCESSING", updatedAt: minutesAgo(10) } });

    const sweeper = new SweeperService(new SystemQueries(ctx.prisma), ctx.queue);
    expect(await sweeper.runOnce()).toBe(2);
    expect(await sweeper.runOnce()).toBe(0); // they were just handled, so the next sweep leaves them alone

    running = createDocumentWorker({
      processor: ctx.processor,
      redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
      prefix: TEST_QUEUE_PREFIX,
      concurrency: 1,
      timeoutSeconds: 60,
    });
    await waitFor(async () => (await documentRow(neverQueued)).status === "READY" && (await documentRow(workerDied)).status === "READY");
    expect((await documentRow(fresh)).status).toBe("UPLOADED"); // not stuck, not swept
  });

  it("leaves finished and failed documents alone", async () => {
    const { wid } = await aliceWorkspace();
    const ready = await storeDocument(wid, "TXT", fixtures.txt("A finished note, long enough to count."), "r.txt");
    const failed = await storeDocument(wid, "TXT", fixtures.txt("A failed note, long enough to count."), "f.txt");
    await ctx.prisma.document.update({ where: { id: ready }, data: { status: "READY", updatedAt: minutesAgo(60) } });
    await ctx.prisma.document.update({ where: { id: failed }, data: { status: "FAILED", statusDetail: "x", updatedAt: minutesAgo(60) } });
    expect(await new SweeperService(new SystemQueries(ctx.prisma), ctx.queue).runOnce()).toBe(0);
  });
});
