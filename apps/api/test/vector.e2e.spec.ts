import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { chunkPages, chunkSettingsFrom } from "../src/chunking";
import { replaceChunks } from "../src/chunking/save-chunks";
import { ENV } from "../src/config/config.module";
import type { Env } from "../src/config/env";
import { ChunkEmbedder } from "../src/embedding/chunk-embedder";
import { forWorkspace } from "../src/prisma/tenant-client";
import { searchChunks } from "../src/search/plain-search";
import { searchChunksWithIndex } from "../src/search/qdrant-search";
import { STORAGE, type StorageService } from "../src/storage/storage.service";
import { missingPointIds, stalePointIds } from "../src/vector/consistency";
import { VectorIndexError, VectorIndexService } from "../src/vector/vector-index.service";
import { createTestApp, fixtures, registerUser, resetDb, resetStorage, type TestContext } from "./helpers";

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
  ctx.embeddings.reset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const storage = () => ctx.app.get<StorageService>(STORAGE);

async function storeDocument(workspaceId: string, text: string, name = "doc.txt") {
  const bytes = fixtures.txt(text);
  const id = randomUUID();
  const storageKey = `${workspaceId}/${id}`;
  await storage().put(storageKey, bytes);
  await ctx.prisma.document.create({
    data: { id, workspaceId, originalName: name, type: "TXT", sizeBytes: bytes.length, contentHash: createHash("sha256").update(bytes).digest("hex"), storageKey },
  });
  return id;
}

async function alice() {
  const user = await registerUser(ctx.app, "alice@a.com", "Alice");
  return { ...user, wid: user.me.activeWorkspaceId! };
}

/** Reads, embeds and indexes a document the way the workers do, so it is Ready and in Qdrant. */
async function readyDocument(wid: string, text: string, name?: string) {
  const id = await storeDocument(wid, text, name);
  expect(await ctx.processor.process({ documentId: id, workspaceId: wid })).toBe("indexing");
  expect(await ctx.indexer.index({ documentId: id, workspaceId: wid })).toBe("ready");
  return id;
}

const bigText = (paragraphs = 40, tag = "p") =>
  Array.from({ length: paragraphs }, (_, i) => `Paragraph ${tag}${i} covers topic number ${i * 7919} and explains one separate rule about equipment, travel or expenses in some detail.`.repeat(2)).join("\n\n");

const chunksOf = (id: string) => ctx.prisma.documentChunk.findMany({ where: { documentId: id }, orderBy: { chunkIndex: "asc" } });
const db = (wid: string) => forWorkspace(ctx.prisma, wid);
const env = () => ctx.app.get<Env>(ENV);
const rawPoints = (ids: string[]) =>
  (ctx.vectorIndex as unknown as { client: { retrieve: (c: string, o: object) => Promise<{ id: string; payload: Record<string, unknown> }[]> } }).client.retrieve(ctx.vectorIndex.collection, { ids, with_payload: true });

describe("the collection", () => {
  it("exists with the right size and distance, and preparing it again changes nothing", async () => {
    await ctx.vectorIndex.ensureCollection();
    await ctx.vectorIndex.ensureCollection();
    const info = await (ctx.vectorIndex as unknown as { client: { getCollection: (n: string) => Promise<any> } }).client.getCollection(ctx.vectorIndex.collection);
    expect(info.config.params.vectors).toMatchObject({ size: 768, distance: "Cosine" });
    expect(info.payload_schema.workspace_id.params).toMatchObject({ type: "keyword", is_tenant: true });
    for (const field of ["document_id", "strategy", "setup_id"]) expect(info.payload_schema[field].data_type).toBe("keyword");
  });

  it("refuses to use an existing collection that has a different vector size", async () => {
    const other = new VectorIndexService({ ...env(), EMBEDDING_DIMENSIONS: 4 });
    await expect(other.ensureCollection()).rejects.toThrow(/expected 4 and Cosine/);
  });

  it("does not stop the app from starting when Qdrant is unreachable, and reports a problem with no HTTP status", async () => {
    const down = new VectorIndexService({ ...env(), QDRANT_URL: "http://127.0.0.1:1", QDRANT_COLLECTION: "never" });
    await expect(down.onModuleInit()).resolves.toBeUndefined();
    const err = await down.ensureCollection().catch((e) => e);
    expect(err).toBeInstanceOf(VectorIndexError);
    expect((err as { status?: number }).status).toBeUndefined(); // so the indexer treats it as temporary, not as a refused request
  });
});

describe("writing a document to the index", () => {
  it("writes one point per chunk, keyed by the chunk id, with ids and positions only (no text)", async () => {
    const a = await alice();
    const id = await readyDocument(a.wid, bigText());
    const chunks = await chunksOf(id);
    expect(chunks.length).toBeGreaterThan(3);

    expect(await ctx.vectorIndex.countForDocument(a.wid, id)).toBe(chunks.length);
    const points = await rawPoints(chunks.map((c) => c.id));
    expect(points).toHaveLength(chunks.length);
    const first = points.find((p) => p.id === chunks[0].id)!;
    expect(first.payload).toEqual({
      workspace_id: a.wid,
      document_id: id,
      chunk_id: chunks[0].id,
      chunk_index: 0,
      page: 1,
      strategy: "paragraph",
      setup_id: ctx.embeddings.setupId,
    });
    expect(JSON.stringify(first.payload)).not.toContain("Paragraph"); // the chunk text is not stored in Qdrant
  });

  it("can be run again without doubling anything", async () => {
    const a = await alice();
    const id = await readyDocument(a.wid, bigText());
    const total = (await chunksOf(id)).length;
    const again = await ctx.vectorIndex.syncDocument(db(a.wid), id, ctx.embeddings.setupId, "paragraph");
    expect(again).toEqual({ written: total, removed: 0 });
    expect(await ctx.vectorIndex.countForDocument(a.wid, id)).toBe(total);
  });

  it("after the document is cut again, the old points are removed and the new ones are there", async () => {
    const a = await alice();
    const id = await readyDocument(a.wid, bigText());
    const oldIds = (await chunksOf(id)).map((c) => c.id);

    // Cut the same pages with smaller chunks, embed them, and bring the index up to date.
    const d = db(a.wid);
    const pages = await d.documentPage.findMany({ where: { documentId: id }, select: { pageNumber: true, text: true } });
    const smaller = chunkPages(pages, "paragraph", chunkSettingsFrom({ CHUNK_TARGET_TOKENS: 100, CHUNK_OVERLAP_TOKENS: 10 }));
    await d.transaction((tx) => replaceChunks(tx, a.wid, id, smaller, "paragraph"));
    await new ChunkEmbedder(ctx.embeddings, "paragraph").embedDocument(d, id);
    const result = await ctx.vectorIndex.syncDocument(d, id, ctx.embeddings.setupId, "paragraph");

    const newIds = (await chunksOf(id)).map((c) => c.id);
    expect(newIds.length).toBeGreaterThan(oldIds.length);
    expect(result).toEqual({ written: newIds.length, removed: oldIds.length });
    expect(await ctx.vectorIndex.countForDocument(a.wid, id)).toBe(newIds.length);
    expect(await rawPoints(oldIds)).toHaveLength(0);
  });
});

describe("searching", () => {
  const topics = {
    leave: "Employees receive twenty five days of paid annual leave every calendar year. Unused leave carries over until March.",
    parking: "Staff parking spaces are allocated by a monthly draw. Bicycle storage is free and needs no booking.",
    travel: "Flights and hotels are booked through the company travel desk. Hotel stays are reimbursed up to a fixed nightly limit.",
    sick: "Sick pay is paid for up to twenty eight weeks. A doctor's note is needed after seven days of absence.",
  };
  async function withTopics(wid: string) {
    const ids: Record<string, string> = {};
    for (const [name, text] of Object.entries(topics)) ids[name] = await readyDocument(wid, text, `${name}.txt`);
    return ids;
  }
  const questions = ["how many days of annual leave do employees get", "where do I park my bicycle", "hotel and flights booking", "how long is sick pay paid and when do I need a note"];

  it("returns what the plain exact search returns, in the same order, with the same scores (the wiring is right)", async () => {
    const a = await alice();
    await withTopics(a.wid);
    const d = db(a.wid);
    for (const q of questions) {
      const exact = await searchChunks(d, ctx.embeddings, "paragraph", q, 4);
      const viaQdrant = await searchChunksWithIndex(d, ctx.vectorIndex, ctx.embeddings, "paragraph", q, 4);
      expect(viaQdrant, q).toHaveLength(exact.length);
      viaQdrant.forEach((h, i) => {
        expect(h.score, `${q}, rank ${i + 1}`).toBeCloseTo(exact[i].score, 4); // the scores match at every rank
        // The same chunk, wherever the score is not tied. (Two chunks with exactly equal scores may come in either
        // order. The fake vectors tie for unrelated text, real embedding vectors almost never do.)
        const tied = [exact[i - 1], exact[i + 1]].some((n) => n && Math.abs(n.score - exact[i].score) < 1e-6);
        if (!tied) expect(h.chunkId, `${q}, rank ${i + 1}`).toBe(exact[i].chunkId);
      });
      expect(viaQdrant[0].chunkId).toBe(exact[0].chunkId);
      expect(viaQdrant[0].text).toBe(exact[0].text); // the text comes from Postgres
      expect(viaQdrant[0].documentName).toBe(exact[0].documentName);
    }
  });

  it("gives the same answer with the exact mode switched on", async () => {
    const a = await alice();
    await withTopics(a.wid);
    const d = db(a.wid);
    const q = questions[0];
    const normal = await searchChunksWithIndex(d, ctx.vectorIndex, ctx.embeddings, "paragraph", q, 4);
    const exact = await searchChunksWithIndex(d, ctx.vectorIndex, ctx.embeddings, "paragraph", q, 4, { exact: true });
    expect(exact.map((h) => h.chunkId)).toEqual(normal.map((h) => h.chunkId));
  });

  it("never returns another workspace's chunk, even when it is the closest match in the whole collection", async () => {
    const a = await alice();
    const bob = await registerUser(ctx.app, "bob@b.com", "Bob");
    const bw = bob.me.activeWorkspaceId!;
    await withTopics(a.wid);
    const secret = await readyDocument(bw, "Annual leave for the whole board of directors is fifty days, decided in secret.", "bob.txt");

    // Searched with no workspace at all, Bob's chunk is the closest: this is what the filter has to prevent.
    const q = "annual leave for the board of directors fifty days";
    const [vector] = await ctx.embeddings.embed([q], "query");
    const everyone = await (ctx.vectorIndex as unknown as { client: { query: (c: string, o: object) => Promise<{ points: { payload: { document_id: string } }[] }> } }).client.query(ctx.vectorIndex.collection, {
      query: vector, limit: 3, with_payload: true,
    });
    expect(everyone.points[0].payload.document_id).toBe(secret);

    const hits = await searchChunksWithIndex(db(a.wid), ctx.vectorIndex, ctx.embeddings, "paragraph", q, 10);
    expect(hits.map((h) => h.documentName).sort()).toEqual(["leave.txt", "parking.txt", "sick.txt", "travel.txt"]);
    expect(hits.some((h) => h.documentId === secret)).toBe(false);
    // Bob searching finds only his own.
    const bobHits = await searchChunksWithIndex(db(bw), ctx.vectorIndex, ctx.embeddings, "paragraph", q, 10);
    expect(bobHits.map((h) => h.documentId)).toEqual([secret]);
  });

  it("only compares vectors made with the current embedding setup", async () => {
    const a = await alice();
    await withTopics(a.wid);
    ctx.embeddings.setupId = "fake-embedding|768|w2";
    expect(await searchChunksWithIndex(db(a.wid), ctx.vectorIndex, ctx.embeddings, "paragraph", "annual leave", 5)).toEqual([]);
  });

  it("keeps the chunking strategies apart: a search for one never returns the other's chunks", async () => {
    const a = await alice();
    const id = await readyDocument(a.wid, bigText(30));
    const d = db(a.wid);
    // The same pages, cut with the naive strategy, embedded, and added to the index next to the paragraph chunks.
    const pages = await d.documentPage.findMany({ where: { documentId: id }, select: { pageNumber: true, text: true } });
    await d.transaction((tx) => replaceChunks(tx, a.wid, id, chunkPages(pages, "fixed", chunkSettingsFrom({ CHUNK_TARGET_TOKENS: 500, CHUNK_OVERLAP_TOKENS: 60 })), "fixed"));
    await new ChunkEmbedder(ctx.embeddings, "fixed").embedDocument(d, id);
    await ctx.vectorIndex.syncDocument(d, id, ctx.embeddings.setupId, "fixed");

    const paragraph = await searchChunksWithIndex(d, ctx.vectorIndex, ctx.embeddings, "paragraph", "topic number 7919", 50);
    const fixed = await searchChunksWithIndex(d, ctx.vectorIndex, ctx.embeddings, "fixed", "topic number 7919", 50);
    const strategyOf = async (ids: string[]) => new Set((await ctx.prisma.documentChunk.findMany({ where: { id: { in: ids } }, select: { strategy: true } })).map((c) => c.strategy));
    expect(paragraph.length).toBeGreaterThan(0);
    expect(fixed.length).toBeGreaterThan(0);
    expect(await strategyOf(paragraph.map((h) => h.chunkId))).toEqual(new Set(["paragraph"]));
    expect(await strategyOf(fixed.map((h) => h.chunkId))).toEqual(new Set(["fixed"]));
  });

  it("does not return a document that is not Ready", async () => {
    const a = await alice();
    const ids = await withTopics(a.wid);
    await ctx.prisma.document.update({ where: { id: ids.leave }, data: { status: "INDEXING" } }); // being read again
    const hits = await searchChunksWithIndex(db(a.wid), ctx.vectorIndex, ctx.embeddings, "paragraph", "annual leave", 10);
    expect(hits.some((h) => h.documentId === ids.leave)).toBe(false);
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe("deleting", () => {
  it("removes a deleted document's points, and only that document's", async () => {
    const a = await alice();
    const bob = await registerUser(ctx.app, "bob@b.com", "Bob");
    const bw = bob.me.activeWorkspaceId!;
    const one = await readyDocument(a.wid, bigText(10, "a"), "one.txt");
    const two = await readyDocument(a.wid, bigText(10, "b"), "two.txt");
    const bobs = await readyDocument(bw, bigText(10, "c"), "bob.txt");
    const twoCount = await ctx.vectorIndex.countForDocument(a.wid, two);

    expect((await a.agent.delete(`/documents/${one}`)).status).toBe(204);
    expect(await ctx.vectorIndex.countForDocument(a.wid, one)).toBe(0);
    expect(await ctx.vectorIndex.countForDocument(a.wid, two)).toBe(twoCount);
    expect(await ctx.vectorIndex.countForDocument(bw, bobs)).toBeGreaterThan(0);
  });

  it("still deletes the document when Qdrant cannot be reached, and the leftovers are found by the consistency check", async () => {
    const a = await alice();
    const id = await readyDocument(a.wid, bigText(10));
    const chunkIds = (await chunksOf(id)).map((c) => c.id);
    vi.spyOn(ctx.vectorIndex, "deleteDocument").mockRejectedValue(new VectorIndexError("deleting a document", "down"));

    expect((await a.agent.delete(`/documents/${id}`)).status).toBe(204);
    expect(await ctx.prisma.document.count({ where: { id } })).toBe(0);
    // Qdrant still has the points, but no search can show them: the text is read from Postgres.
    expect(await ctx.vectorIndex.countForDocument(a.wid, id)).toBe(chunkIds.length);
    const pointIds = await ctx.vectorIndex.listPointIds(a.wid);
    const remaining = await ctx.prisma.documentChunk.findMany({ where: { workspaceId: a.wid }, select: { id: true } });
    expect(stalePointIds(pointIds, remaining.map((c) => c.id)).sort()).toEqual([...chunkIds].sort());
    await ctx.vectorIndex.deletePoints(stalePointIds(pointIds, remaining.map((c) => c.id)));
    expect(await ctx.vectorIndex.countForDocument(a.wid, id)).toBe(0);
  });
});

describe("Ready means it is in the search index", () => {
  it("marks the document Ready only after its points are written", async () => {
    const a = await alice();
    const id = await storeDocument(a.wid, bigText(10));
    await ctx.processor.process({ documentId: id, workspaceId: a.wid });
    const seen: number[] = [];
    const real = ctx.vectorIndex.syncDocument.bind(ctx.vectorIndex);
    vi.spyOn(ctx.vectorIndex, "syncDocument").mockImplementation(async (...args) => {
      seen.push((await ctx.prisma.document.findUniqueOrThrow({ where: { id } })).status === "INDEXING" ? 1 : 0);
      return real(...args);
    });

    expect(await ctx.indexer.index({ documentId: id, workspaceId: a.wid })).toBe("ready");
    expect(seen).toEqual([1]); // it was still Indexing while the points were written
    expect(await ctx.vectorIndex.countForDocument(a.wid, id)).toBe((await chunksOf(id)).length);
  });

  it("stays Indexing and is retried when the search index fails, and gives up with a plain reason on the last attempt", async () => {
    const a = await alice();
    const id = await storeDocument(a.wid, bigText(10));
    await ctx.processor.process({ documentId: id, workspaceId: a.wid });
    vi.spyOn(ctx.vectorIndex, "syncDocument").mockRejectedValue(new VectorIndexError("writing a document", "connection refused"));

    await expect(ctx.indexer.index({ documentId: id, workspaceId: a.wid }, { number: 1, max: 3 })).rejects.toThrow(/Search index problem/);
    expect((await ctx.prisma.document.findUniqueOrThrow({ where: { id } })).status).toBe("INDEXING");

    expect(await ctx.indexer.index({ documentId: id, workspaceId: a.wid }, { number: 3, max: 3 })).toBe("failed");
    const doc = await ctx.prisma.document.findUniqueOrThrow({ where: { id } });
    expect(doc.status).toBe("FAILED");
    expect(doc.statusDetail).toMatch(/temporary problem/);
    expect(doc.statusDetail).not.toMatch(/AI service/); // not blamed on the embedding provider
  });

  it("succeeds on a later attempt once the search index is back, without embedding anything again", async () => {
    const a = await alice();
    const id = await storeDocument(a.wid, bigText(10));
    await ctx.processor.process({ documentId: id, workspaceId: a.wid });
    const sync = vi.spyOn(ctx.vectorIndex, "syncDocument");
    sync.mockRejectedValueOnce(new VectorIndexError("writing a document", "connection refused"));

    await expect(ctx.indexer.index({ documentId: id, workspaceId: a.wid }, { number: 1, max: 3 })).rejects.toThrow();
    const sent = ctx.embeddings.textsSent.length;
    expect(await ctx.indexer.index({ documentId: id, workspaceId: a.wid }, { number: 2, max: 3 })).toBe("ready");
    expect(ctx.embeddings.textsSent.length).toBe(sent); // the vectors were kept: only the index step was repeated
    expect(await ctx.vectorIndex.countForDocument(a.wid, id)).toBe((await chunksOf(id)).length);
  });
});

describe("the consistency helpers", () => {
  it("finds points whose chunk is gone, and chunks whose point is missing", () => {
    expect(stalePointIds(["a", "b", "c"], ["a", "c", "d"])).toEqual(["b"]);
    expect(missingPointIds(["a", "c", "d"], ["a", "b", "c"])).toEqual(["d"]);
    expect(stalePointIds([], ["a"])).toEqual([]);
    expect(missingPointIds([], ["a"])).toEqual([]);
  });
});
