import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { chunkPages, chunkSettingsFrom } from "../src/chunking";
import * as saveChunks from "../src/chunking/save-chunks";
import { forWorkspace } from "../src/prisma/tenant-client";
import { STORAGE, type StorageService } from "../src/storage/storage.service";
import { handbookPdf } from "./file-builders";
import { agent, createTestApp, fixtures, registerUser, resetDb, resetStorage, type TestContext } from "./helpers";

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

async function storeDocument(workspaceId: string, type: "PDF" | "TXT", bytes: Buffer, name = `file.${type.toLowerCase()}`) {
  const id = randomUUID();
  const storageKey = `${workspaceId}/${id}`;
  await storage().put(storageKey, bytes);
  await ctx.prisma.document.create({
    data: { id, workspaceId, originalName: name, type, sizeBytes: bytes.length, contentHash: createHash("sha256").update(bytes).digest("hex"), storageKey },
  });
  return id;
}

async function alice() {
  const user = await registerUser(ctx.app, "alice@a.com", "Alice");
  return { ...user, wid: user.me.activeWorkspaceId! };
}

// About 6,000 characters in six paragraphs: several chunks at the default size (500 tokens, about 2,000 characters).
const longText = () =>
  Array.from({ length: 6 }, (_, p) =>
    Array.from({ length: 10 }, (_, s) => `Paragraph ${p + 1} sentence ${s + 1} explains one small rule about how the company handles equipment.`).join(" "),
  ).join("\n\n");

const chunksOf = (documentId: string, strategy?: string) =>
  ctx.prisma.documentChunk.findMany({ where: { documentId, ...(strategy && { strategy }) }, orderBy: { chunkIndex: "asc" } });

describe("processing saves chunks", () => {
  it("saves chunks with the pages, and every chunk is exactly a slice of its page", async () => {
    const { wid } = await alice();
    const id = await storeDocument(wid, "TXT", fixtures.txt(longText()));

    expect(await ctx.processor.process({ documentId: id, workspaceId: wid })).toBe("indexing");

    const pages = await ctx.prisma.documentPage.findMany({ where: { documentId: id } });
    const chunks = await chunksOf(id);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
    for (const c of chunks) {
      const page = pages.find((p) => p.pageNumber === c.pageNumber)!;
      expect(page.text.slice(c.startChar, c.endChar)).toBe(c.text);
      expect(c).toMatchObject({ workspaceId: wid, strategy: "paragraph", tokenEstimate: Math.ceil(c.text.length / 4) });
      expect(c.contentHash).toBe(createHash("sha256").update(c.text).digest("hex"));
    }
  });

  it("chunks a multi-page PDF page by page, and no chunk crosses a page", async () => {
    const { wid } = await alice();
    const id = await storeDocument(wid, "PDF", await handbookPdf(), "handbook.pdf");
    await ctx.processor.process({ documentId: id, workspaceId: wid });

    const chunks = await chunksOf(id);
    expect(new Set(chunks.map((c) => c.pageNumber))).toEqual(new Set([1, 2, 3]));
    expect(chunks.map((c) => c.pageNumber)).toEqual([...chunks.map((c) => c.pageNumber)].sort((a, b) => a - b));
  });

  it("replaces every earlier chunk of every strategy when it runs again (a run that crashed half way, then a retry)", async () => {
    const { wid } = await alice();
    const id = await storeDocument(wid, "TXT", fixtures.txt(longText()));
    const stale = (strategy: string, chunkIndex: number) => ({
      workspaceId: wid, documentId: id, pageNumber: 1, chunkIndex, strategy, startChar: 0, endChar: 5, text: "stale", tokenEstimate: 2, contentHash: "x",
    });
    await ctx.prisma.documentChunk.createMany({ data: [stale("paragraph", 0), stale("paragraph", 1), stale("fixed", 0)] });
    await ctx.prisma.document.update({ where: { id }, data: { status: "PROCESSING" } });

    expect(await ctx.processor.process({ documentId: id, workspaceId: wid })).toBe("indexing");

    const chunks = await chunksOf(id);
    expect(chunks.some((c) => c.text === "stale")).toBe(false);
    expect(new Set(chunks.map((c) => c.strategy))).toEqual(new Set(["paragraph"]));
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
  });

  it("saves pages, chunks and the Ready status together: if the chunks fail, none of it is kept", async () => {
    const { wid } = await alice();
    const id = await storeDocument(wid, "TXT", fixtures.txt(longText()));
    vi.spyOn(saveChunks, "replaceChunks").mockRejectedValue(new Error("database hiccup"));

    await expect(ctx.processor.process({ documentId: id, workspaceId: wid }, { number: 1, max: 3 })).rejects.toThrow("database hiccup");

    expect(await ctx.prisma.documentPage.count({ where: { documentId: id } })).toBe(0);
    expect(await chunksOf(id)).toHaveLength(0);
    expect((await ctx.prisma.document.findUniqueOrThrow({ where: { id } })).status).toBe("PROCESSING"); // not Ready
  });

  it("a page with no text produces no chunks", async () => {
    const { wid } = await alice();
    const id = await storeDocument(wid, "TXT", fixtures.txt("Just one short line of text here."));
    await ctx.processor.process({ documentId: id, workspaceId: wid });
    expect((await chunksOf(id)).map((c) => c.text)).toEqual(["Just one short line of text here."]);
  });
});

describe("saveChunks.replaceChunks", () => {
  it("with a strategy, replaces only that strategy and leaves the other one alone", async () => {
    const { wid } = await alice();
    const id = await storeDocument(wid, "TXT", fixtures.txt(longText()));
    await ctx.processor.process({ documentId: id, workspaceId: wid });
    const paragraphBefore = (await chunksOf(id, "paragraph")).map((c) => c.id);

    const db = forWorkspace(ctx.prisma, wid);
    const pages = await db.documentPage.findMany({ where: { documentId: id }, select: { pageNumber: true, text: true } });
    const settings = chunkSettingsFrom({ CHUNK_TARGET_TOKENS: 500, CHUNK_OVERLAP_TOKENS: 60 });
    await db.transaction((tx) => saveChunks.replaceChunks(tx, wid, id, chunkPages(pages, "fixed", settings), "fixed"));
    await db.transaction((tx) => saveChunks.replaceChunks(tx, wid, id, chunkPages(pages, "fixed", settings), "fixed")); // twice: no doubling

    expect((await chunksOf(id, "paragraph")).map((c) => c.id)).toEqual(paragraphBefore);
    const fixed = await chunksOf(id, "fixed");
    expect(fixed.length).toBe(chunkPages(pages, "fixed", settings).length);
  });
});

describe("GET /documents/:id/chunks", () => {
  it("returns the chunks in order, with how much each one repeats of the one before", async () => {
    const a = await alice();
    const id = await storeDocument(a.wid, "TXT", fixtures.txt(longText()));
    await ctx.processor.process({ documentId: id, workspaceId: a.wid });

    const res = await a.agent.get(`/documents/${id}/chunks`);
    expect(res.status).toBe(200);
    expect(res.body.strategy).toBe("paragraph");
    expect(res.body.document).toMatchObject({ id, status: "INDEXING", chunkCount: res.body.chunks.length });
    const chunks = res.body.chunks as { chunkIndex: number; startChar: number; endChar: number; overlapWithPrevious: number }[];
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
    expect(chunks[0].overlapWithPrevious).toBe(0);
    chunks.slice(1).forEach((c, i) => expect(c.overlapWithPrevious).toBe(Math.max(0, chunks[i].endChar - c.startChar)));
    expect(chunks.some((c) => c.overlapWithPrevious > 0)).toBe(true);
  });

  it("shows the chunk count in the document list, counting only the configured strategy", async () => {
    const a = await alice();
    const id = await storeDocument(a.wid, "TXT", fixtures.txt(longText()));
    await ctx.processor.process({ documentId: id, workspaceId: a.wid });
    const paragraphCount = (await chunksOf(id, "paragraph")).length;

    const db = forWorkspace(ctx.prisma, a.wid);
    const pages = await db.documentPage.findMany({ where: { documentId: id }, select: { pageNumber: true, text: true } });
    await db.transaction((tx) =>
      saveChunks.replaceChunks(tx, a.wid, id, chunkPages(pages, "fixed", chunkSettingsFrom({ CHUNK_TARGET_TOKENS: 100, CHUNK_OVERLAP_TOKENS: 10 })), "fixed"),
    );
    expect((await chunksOf(id, "fixed")).length).toBeGreaterThan(paragraphCount);

    const list = (await a.agent.get("/documents")).body as { id: string; chunkCount: number }[];
    expect(list.find((d) => d.id === id)?.chunkCount).toBe(paragraphCount);

    const fixed = await a.agent.get(`/documents/${id}/chunks?strategy=fixed`);
    expect(fixed.body.strategy).toBe("fixed");
    expect(fixed.body.chunks.length).toBe((await chunksOf(id, "fixed")).length);
  });

  it("refuses an unknown strategy", async () => {
    const a = await alice();
    const id = await storeDocument(a.wid, "TXT", fixtures.txt("Some text that is long enough to read."));
    await ctx.processor.process({ documentId: id, workspaceId: a.wid });
    expect((await a.agent.get(`/documents/${id}/chunks?strategy=magic`)).status).toBe(400);
  });

  it("does not exist for another workspace, and needs a session", async () => {
    const a = await alice();
    const bob = await registerUser(ctx.app, "bob@b.com", "Bob");
    const id = await storeDocument(a.wid, "TXT", fixtures.txt(longText()));
    await ctx.processor.process({ documentId: id, workspaceId: a.wid });

    expect((await a.agent.get(`/documents/${id}/chunks`)).status).toBe(200);
    expect((await bob.agent.get(`/documents/${id}/chunks`)).status).toBe(404);
    expect((await agent(ctx.app).get(`/documents/${id}/chunks`)).status).toBe(401);
  });

  it("deleting a document removes its chunks", async () => {
    const a = await alice();
    const id = await storeDocument(a.wid, "TXT", fixtures.txt(longText()));
    await ctx.processor.process({ documentId: id, workspaceId: a.wid });
    expect((await chunksOf(id)).length).toBeGreaterThan(0);

    expect((await a.agent.delete(`/documents/${id}`)).status).toBe(204);
    expect(await chunksOf(id)).toHaveLength(0);
  });
});
