import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chunkPages, chunkSettingsFrom } from "../src/chunking";
import { replaceChunks } from "../src/chunking/save-chunks";
import { ENV } from "../src/config/config.module";
import type { Env } from "../src/config/env";
import { ChunkEmbedder } from "../src/embedding/chunk-embedder";
import { runEvaluation } from "../src/evaluation/runner";
import type { EvalQuestion, QuestionFile } from "../src/evaluation/questions";
import { forWorkspace } from "../src/prisma/tenant-client";
import { searchChunksByVector } from "../src/search/qdrant-search";
import { STORAGE, type StorageService } from "../src/storage/storage.service";
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

const db = (wid: string) => forWorkspace(ctx.prisma, wid);
const env = () => ctx.app.get<Env>(ENV);

/** 30 sections, each a heading line and a paragraph with words that belong to that section alone. */
const guideText = () =>
  Array.from({ length: 30 }, (_, i) => {
    const rules = Array.from({ length: 8 }, (_, k) => `Rule ${i}-${k} item${i}q${k} code${i}z${k}.`).join(" ");
    return `Topic ${i} rules\n\n${rules}`;
  }).join("\n\n");
// All sixteen rare words of one section. The fake word-count vectors have only 768 buckets, so a question with few
// rare words, or a text with many repeated common words, can lose to a wrong chunk by chance. The data never changes,
// and the three questions below were picked because they have a wide margin under both strategies.
const ask = (i: number) => [0, 1, 2, 3, 4, 5, 6, 7].map((k) => `item${i}q${k} code${i}z${k}`).join(" ");

async function readyDocument(text: string, name = "guide.txt") {
  const user = await registerUser(ctx.app, "alice@a.com", "Alice");
  const wid = user.me.activeWorkspaceId!;
  const bytes = fixtures.txt(text);
  const id = randomUUID();
  const storageKey = `${wid}/${id}`;
  await ctx.app.get<StorageService>(STORAGE).put(storageKey, bytes);
  await ctx.prisma.document.create({
    data: { id, workspaceId: wid, originalName: name, type: "TXT", sizeBytes: bytes.length, contentHash: createHash("sha256").update(bytes).digest("hex"), storageKey },
  });
  expect(await ctx.processor.process({ documentId: id, workspaceId: wid })).toBe("indexing");
  expect(await ctx.indexer.index({ documentId: id, workspaceId: wid })).toBe("ready");
  return { wid, id, d: db(wid) };
}

/** Adds the heading chunks of a document next to its paragraph chunks, embeds them and puts them in Qdrant. */
async function addHeadingStrategy(wid: string, id: string) {
  const d = db(wid);
  const pages = await d.documentPage.findMany({ where: { documentId: id }, select: { pageNumber: true, text: true } });
  const drafts = chunkPages(pages, "heading", chunkSettingsFrom(env()));
  await d.transaction((tx) => replaceChunks(tx, wid, id, drafts, "heading"));
  await new ChunkEmbedder(ctx.embeddings, "heading").embedDocument(d, id);
  await ctx.vectorIndex.syncDocument(d, id, ctx.embeddings.setupId, "heading");
  return drafts;
}

describe("the heading strategy next to the paragraph strategy", () => {
  it("stores each chunk's heading, and leaves the paragraph chunks (ids and all) untouched", async () => {
    const { wid, id, d } = await readyDocument(guideText());
    const before = await d.documentChunk.findMany({ where: { documentId: id, strategy: "paragraph" }, orderBy: { chunkIndex: "asc" } });
    expect(before.length).toBeGreaterThan(2);
    expect(before.every((c) => c.heading === null)).toBe(true);

    const drafts = await addHeadingStrategy(wid, id);
    const headingChunks = await d.documentChunk.findMany({ where: { documentId: id, strategy: "heading" }, orderBy: { chunkIndex: "asc" } });
    expect(headingChunks).toHaveLength(drafts.length);
    expect(headingChunks.every((c) => c.heading !== null && /^Topic \d+ rules$/.test(c.heading!))).toBe(true);
    // every heading chunk starts at a heading: its text starts with its own heading line
    expect(headingChunks.every((c) => c.text.startsWith(c.heading!))).toBe(true);

    const after = await d.documentChunk.findMany({ where: { documentId: id, strategy: "paragraph" }, orderBy: { chunkIndex: "asc" } });
    expect(after.map((c) => c.id)).toEqual(before.map((c) => c.id)); // the baseline chunks were not rewritten
    expect(after.every((c) => c.heading === null)).toBe(true);
  });

  it("keeps both strategies' points in Qdrant, and a search only ever returns the strategy it asked for", async () => {
    const { wid, id, d } = await readyDocument(guideText());
    const paragraphCount = await d.documentChunk.count({ where: { documentId: id, strategy: "paragraph" } });
    await addHeadingStrategy(wid, id);
    const headingCount = await d.documentChunk.count({ where: { documentId: id, strategy: "heading" } });

    expect(await ctx.vectorIndex.countForDocument(wid, id)).toBe(paragraphCount + headingCount); // syncing one strategy did not delete the other's points
    const [vector] = await ctx.embeddings.embed([ask(12)], "query");
    const ids = async (strategy: "paragraph" | "heading") =>
      (await searchChunksByVector(d, ctx.vectorIndex, ctx.embeddings.setupId, strategy, vector, 5)).map((h) => h.chunkId);
    const paragraphIds = new Set((await d.documentChunk.findMany({ where: { strategy: "paragraph" }, select: { id: true } })).map((c) => c.id));
    expect((await ids("heading")).every((chunkId) => !paragraphIds.has(chunkId))).toBe(true);
    expect((await ids("paragraph")).every((chunkId) => paragraphIds.has(chunkId))).toBe(true);
  });

  it("can be run through the evaluation harness, separately from the other strategy", async () => {
    const { wid, id, d } = await readyDocument(guideText());
    await addHeadingStrategy(wid, id);
    const question = (n: number): EvalQuestion => ({
      id: `q${n}`, status: "keep", question: ask(n), answerable: true, kind: "plain",
      answers: [{ document: "guide.txt", quote: `Rule ${n}-1 item${n}q1` }],
    });
    const file: QuestionFile = { name: "test", questions: [question(19), question(16), question(11)], sha256: "a".repeat(64), path: "/x/test.json" };
    const chunkSettings = { targetTokens: 500, overlapTokens: 60 };
    const deps = { db: d, index: ctx.vectorIndex, embeddings: ctx.embeddings };

    const heading = await runEvaluation(deps, file, { strategy: "heading", chunkSettings });
    const paragraph = await runEvaluation(deps, file, { strategy: "paragraph", chunkSettings });
    expect(heading.strategy).toBe("heading");
    expect(heading.metrics.hitRate[1]).toBe(1);
    expect(paragraph.metrics.hitRate[1]).toBe(1);
    // each run searched only its own chunks
    expect(heading.chunks.count).toBe(await d.documentChunk.count({ where: { strategy: "heading" } }));
    expect(paragraph.chunks.count).toBe(await d.documentChunk.count({ where: { strategy: "paragraph" } }));
    const headingIds = new Set((await d.documentChunk.findMany({ where: { strategy: "heading" }, select: { id: true } })).map((c) => c.id));
    expect(heading.results.every((r) => r.retrieved.every((h) => headingIds.has(h.chunkId)))).toBe(true);
    expect(paragraph.results.every((r) => r.retrieved.every((h) => !headingIds.has(h.chunkId)))).toBe(true);
  });
});
