import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sha256, type ChunkDraft } from "../src/chunking";
import { ChunkEmbedder } from "../src/embedding/chunk-embedder";
import { replaceChunks } from "../src/chunking/save-chunks";
import { checkQuotes, EvalSetupError, runEvaluation, saveRun, writeRunFile } from "../src/evaluation/runner";
import type { EvalQuestion, QuestionFile } from "../src/evaluation/questions";
import { forWorkspace } from "../src/prisma/tenant-client";
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

const storage = () => ctx.app.get<StorageService>(STORAGE);
const db = (wid: string) => forWorkspace(ctx.prisma, wid);
const chunkSettings = { targetTokens: 500, overlapTokens: 60 };

async function readyDocument(workspaceId: string, text: string, name: string) {
  const bytes = fixtures.txt(text);
  const id = randomUUID();
  const storageKey = `${workspaceId}/${id}`;
  await storage().put(storageKey, bytes);
  await ctx.prisma.document.create({
    data: { id, workspaceId, originalName: name, type: "TXT", sizeBytes: bytes.length, contentHash: createHash("sha256").update(bytes).digest("hex"), storageKey },
  });
  expect(await ctx.processor.process({ documentId: id, workspaceId })).toBe("indexing");
  expect(await ctx.indexer.index({ documentId: id, workspaceId })).toBe("ready");
  return id;
}

/**
 * Many short numbered paragraphs, so the document has several chunks. Each paragraph has four rare words that no other
 * paragraph has, and a question made of those four words points at its chunk. (The fake embedding counts words into 768
 * buckets, so a single rare word can be drowned by chance collisions. Four cannot, and the data never changes.)
 */
const paragraphs = (tag: string, count = 80, extra?: { at: number; text: string }) =>
  Array.from({ length: count }, (_, i) => (extra && i === extra.at ? extra.text : `Paragraph ${tag}${i} covers topic number ${i * 7919} and explains rule ${tag}r${i} with code ${tag}c${i * 7919}.`)).join("\n\n");
const line = (tag: string, i: number) => `Paragraph ${tag}${i} covers topic number ${i * 7919}`;
/** A question that uses the four rare words of one paragraph. */
const ask = (tag: string, i: number) => `${tag}${i} ${i * 7919} ${tag}r${i} ${tag}c${i * 7919}`;

const question = (id: string, text: string, answers: EvalQuestion["answers"], over: Partial<EvalQuestion> = {}): EvalQuestion => ({
  id, status: "keep", question: text, answerable: answers.length > 0, answers, kind: "plain", ...over,
});
const fileOf = (questions: EvalQuestion[]): QuestionFile => ({ name: "test-set", questions, sha256: "f".repeat(64), path: "/somewhere/test-set.json" });

async function twoDocuments() {
  const user = await registerUser(ctx.app, "alice@a.com", "Alice");
  const wid = user.me.activeWorkspaceId!;
  const alpha = await readyDocument(wid, paragraphs("a"), "alpha.txt");
  const beta = await readyDocument(wid, paragraphs("b"), "beta.txt");
  return { wid, alpha, beta, db: db(wid) };
}
const deps = (d: ReturnType<typeof db>) => ({ db: d, index: ctx.vectorIndex, embeddings: ctx.embeddings });
const run = (d: ReturnType<typeof db>, questions: EvalQuestion[], over: object = {}) =>
  runEvaluation(deps(d), fileOf(questions), { strategy: "paragraph", chunkSettings, ...over });

describe("running the questions", () => {
  it("scores answerable questions by rank, leaves unanswerable ones out, and embeds all questions in one call", async () => {
    const { db: d } = await twoDocuments();
    const questions = [
      question("q1", ask("a", 30), [{ document: "alpha.txt", quote: line("a", 30) }]),
      question("q2", ask("b", 55), [{ document: "beta.txt", quote: line("b", 55) }]),
      question("q3", "quantum banana zebra", []),
    ];
    ctx.embeddings.reset();
    const report = await run(d, questions);

    expect(report.results.map((r) => r.rank)).toEqual([1, 1, null]);
    expect(report.results[0].retrieved[0].documentName).toBe("alpha.txt");
    expect(report.results[0].retrieved).toHaveLength(5);
    expect(report.results[2].topScore).toEqual(expect.any(Number)); // recorded even though nothing is expected
    expect(report.results[2].retrieved.some((r) => r.hit)).toBe(false);
    expect(report.metrics.answerable).toBe(2);
    expect(report.metrics.unanswerable).toBe(1);
    expect(report.metrics.hitRate).toEqual({ 1: 1, 3: 1, 5: 1 });
    expect(report.metrics.mrr).toBe(1);
    expect(report.retrieval).toBe("qdrant");

    // one batch call, for the questions only, as queries
    expect(ctx.embeddings.calls).toHaveLength(1);
    expect(ctx.embeddings.calls[0].purpose).toBe("query");
    expect(ctx.embeddings.calls[0].texts).toEqual(questions.map((q) => q.question));
  });

  it("does not count the right quote in the wrong document as a hit", async () => {
    const shared = "The shared laptop rule says every laptop must be encrypted before any travel.";
    const user = await registerUser(ctx.app, "alice@a.com", "Alice");
    const wid = user.me.activeWorkspaceId!;
    await readyDocument(wid, paragraphs("a", 80, { at: 40, text: shared }), "alpha.txt");
    await readyDocument(wid, paragraphs("b", 80, { at: 40, text: shared }), "beta.txt");

    const report = await run(db(wid), [question("q1", "laptop encrypted before travel", [{ document: "alpha.txt", quote: "every laptop must be encrypted before any travel" }])]);
    const alphaHits = report.results[0].retrieved.filter((r) => r.documentName === "alpha.txt" && r.hit);
    const betaChunks = report.results[0].retrieved.filter((r) => r.documentName === "beta.txt");
    expect(report.results[0].retrieved).toHaveLength(5);
    expect(alphaHits.length).toBeGreaterThanOrEqual(1);
    expect(betaChunks.length).toBeGreaterThanOrEqual(1); // beta's chunk has the same sentence and was retrieved...
    expect(betaChunks.every((r) => !r.hit)).toBe(true); // ...but it is not the document this question expects
    expect(report.results[0].rank).toBeLessThanOrEqual(2);
  });

  it("accepts any of several answers", async () => {
    const { db: d } = await twoDocuments();
    const report = await run(d, [
      question("q1", ask("b", 12), [
        { document: "alpha.txt", quote: line("a", 70) }, // an answer somewhere else that will not be retrieved first
        { document: "beta.txt", quote: line("b", 12) },
      ]),
    ]);
    expect(report.results[0].rank).toBe(1);
    expect(report.results[0].retrieved[0].documentName).toBe("beta.txt");
  });

  it("runs only reviewed questions, and only looks at candidates when asked (and says so)", async () => {
    const { db: d } = await twoDocuments();
    const keep = question("q1", ask("a", 30), [{ document: "alpha.txt", quote: line("a", 30) }]);
    const candidate = question("q2", ask("b", 55), [{ document: "beta.txt", quote: line("b", 55) }], { status: "candidate" });
    const dropped = question("q3", ask("a", 5), [{ document: "alpha.txt", quote: line("a", 5) }], { status: "drop" });

    const normal = await run(d, [keep, candidate, dropped]);
    expect(normal.results.map((r) => r.id)).toEqual(["q1"]);
    expect(normal.questionSet).toMatchObject({ inFile: 3, ran: 1, skipped: { candidate: 1, drop: 1 } });

    const looking = await run(d, [keep, candidate, dropped], { includeUnreviewed: true });
    expect(looking.results.map((r) => r.id)).toEqual(["q1", "q2"]);
    expect(looking.questionSet.skipped).toEqual({ candidate: 0, drop: 1 });

    await expect(run(d, [candidate, dropped])).rejects.toThrow(/No question has status "keep"/);
  });

  it("gives the same answer with Qdrant's exact search", async () => {
    const { db: d } = await twoDocuments();
    const questions = [question("q1", ask("a", 30), [{ document: "alpha.txt", quote: line("a", 30) }])];
    const exact = await run(d, questions, { exact: true });
    expect(exact.retrieval).toBe("qdrant-exact");
    expect(exact.results[0].rank).toBe(1);
  });
});

describe("refusing to produce numbers that would mean nothing", () => {
  it("refuses when an expected quote is not in its document, before any provider call", async () => {
    const { db: d } = await twoDocuments();
    ctx.embeddings.reset();
    const bad = question("q7", "anything", [{ document: "alpha.txt", quote: "a sentence that is not in the document" }]);
    const err = await run(d, [bad]).catch((e) => e);
    expect(err).toBeInstanceOf(EvalSetupError);
    expect(err.message).toMatch(/q7.*is not in alpha\.txt/);
    expect(ctx.embeddings.calls).toHaveLength(0);
  });

  it("refuses when a question names a document the workspace does not have", async () => {
    const { db: d } = await twoDocuments();
    const err = await run(d, [question("q8", "anything", [{ document: "gamma.txt", quote: line("a", 3) }])]).catch((e) => e);
    expect(err.message).toMatch(/q8.*no document named "gamma\.txt"/);
  });

  it("refuses when Qdrant is missing points that Postgres has (a half-built index would give wrong scores)", async () => {
    const { alpha, db: d } = await twoDocuments();
    const ids = (await ctx.prisma.documentChunk.findMany({ where: { documentId: alpha }, select: { id: true } })).map((c) => c.id);
    await ctx.vectorIndex.deletePoints(ids);
    const err = await run(d, [question("q1", "anything", [{ document: "alpha.txt", quote: line("a", 3) }])]).catch((e) => e);
    expect(err).toBeInstanceOf(EvalSetupError);
    expect(err.message).toMatch(/Qdrant holds \d+ points but Postgres has \d+.*qdrant:sync/);
  });

  it("refuses when the chunks have no vectors under the current embedding setup", async () => {
    const { db: d } = await twoDocuments();
    ctx.embeddings.setupId = "another-model|768|w1"; // a model change: every stored vector is out of date
    const err = await run(d, [question("q1", "anything", [{ document: "alpha.txt", quote: line("a", 3) }])]).catch((e) => e);
    expect(err.message).toMatch(/No searchable "paragraph" chunks/);
  });

  it("never sees another workspace's documents", async () => {
    await twoDocuments(); // Alice has alpha.txt and beta.txt
    const bob = await registerUser(ctx.app, "bob@b.com", "Bob");
    const bobWid = bob.me.activeWorkspaceId!;
    await readyDocument(bobWid, paragraphs("c"), "gamma.txt");

    const err = await run(db(bobWid), [question("q1", ask("a", 30), [{ document: "alpha.txt", quote: line("a", 30) }])]).catch((e) => e);
    expect(err.message).toMatch(/no document named "alpha\.txt"/); // Alice's document does not exist for Bob's run

    // and Bob's own run only ever retrieves Bob's chunks
    const ok = await run(db(bobWid), [question("q2", ask("a", 30), [{ document: "gamma.txt", quote: line("c", 30) }])]);
    expect(new Set(ok.results[0].retrieved.map((r) => r.documentName))).toEqual(new Set(["gamma.txt"]));
  });
});

describe("checking quotes against chunks", () => {
  it("tells apart: found, no such document, not in the document, and cut through by chunking", async () => {
    const { alpha, wid, db: d } = await twoDocuments();
    const quote = line("a", 30);

    const states = async () =>
      Object.fromEntries((await checkQuotes(d, "paragraph", [
        question("ok", "x", [{ document: "alpha.txt", quote }]),
        question("nodoc", "x", [{ document: "nowhere.txt", quote }]),
        question("typo", "x", [{ document: "alpha.txt", quote: "Paragraph a30 covers topic number 999999" }]),
      ])).map((c) => [c.questionId, c.state]));
    expect(await states()).toEqual({ ok: "ok", nodoc: "no-such-document", typo: "not-in-document" });

    // Cut the document again so that a chunk boundary falls in the middle of the quote.
    const pages = await d.documentPage.findMany({ where: { documentId: alpha }, select: { pageNumber: true, text: true } });
    const text = pages[0].text;
    const cut = text.indexOf(quote) + 20;
    const piece = (index: number, start: number, end: number): ChunkDraft => ({
      pageNumber: 1, chunkIndex: index, strategy: "paragraph", startChar: start, endChar: end, text: text.slice(start, end), tokenEstimate: 100, contentHash: sha256(text.slice(start, end)),
    });
    await d.transaction((tx) => replaceChunks(tx, wid, alpha, [piece(0, 0, cut), piece(1, cut, text.length)], "paragraph"));
    expect((await states()).ok).toBe("split-across-chunks");

    // A real run over those chunks: no chunk holds the whole quote, so the question is a miss that the report
    // explains as "chunking cut through the answer", separately from a search that simply ranked it badly.
    await new ChunkEmbedder(ctx.embeddings, "paragraph").embedDocument(d, alpha);
    await ctx.vectorIndex.syncDocument(d, alpha, ctx.embeddings.setupId, "paragraph");
    const report = await run(d, [
      question("cut", ask("a", 30), [{ document: "alpha.txt", quote }]),
      question("whole", ask("b", 30), [{ document: "beta.txt", quote: line("b", 30) }]),
    ]);
    expect(report.results.map((r) => [r.id, r.rank, r.reachable])).toEqual([["cut", null, false], ["whole", 1, true]]);
    expect(report.metrics.unreachable).toBe(1);
    expect(report.metrics.hitRate[5]).toBe(0.5);
    expect(report.quoteProblems.map((c) => [c.questionId, c.state])).toEqual([["cut", "split-across-chunks"]]);
  });
});

describe("storing a run", () => {
  it("writes a row for the workspace and a JSON file with the same numbers", async () => {
    const { wid, db: d } = await twoDocuments();
    const report = await run(d, [
      question("q1", ask("a", 30), [{ document: "alpha.txt", quote: line("a", 30) }]),
      question("q2", "quantum banana zebra", []),
    ], { label: "First try!" });

    const id = await saveRun(d, report);
    const row = await ctx.prisma.evalRun.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ workspaceId: wid, label: "First try!", strategy: "paragraph", retrieval: "qdrant", k: 5, questionSet: "test-set", questionCount: 2, answerableCount: 1, hitRate1: 1, hitRate5: 1, mrr: 1 });
    expect(row.setupId).toBe(ctx.embeddings.setupId);
    expect(row.questionFileHash).toBe("f".repeat(64));
    expect((row.results as unknown[]).length).toBe(2);
    expect((row.config as { corpus: { document: string }[] }).corpus.map((c) => c.document)).toEqual(["alpha.txt", "beta.txt"]);
    expect((row.config as { chunks: { count: number; configuredTargetTokens: number } }).chunks).toMatchObject({ configuredTargetTokens: 500 });

    const path = writeRunFile(join(ctx.storageDir, "runs"), id, report);
    expect(existsSync(path)).toBe(true);
    expect(path).toMatch(/-paragraph-first-try\.json$/);
    const file = JSON.parse(readFileSync(path, "utf8"));
    expect(file.runId).toBe(id);
    expect(file.metrics.hitRate["1"]).toBe(1);
    expect(file.results).toHaveLength(2);
  });

  it("puts each score in its own column (the scores differ, so a swapped column would show)", async () => {
    const { db: d } = await twoDocuments();
    const real = await run(d, [question("q1", ask("a", 30), [{ document: "alpha.txt", quote: line("a", 30) }])]);
    const report = {
      ...real,
      metrics: {
        ...real.metrics,
        answerable: 8,
        hitRate: { 1: 0.25, 3: 0.5, 5: 0.75 },
        mrr: 0.4,
        unreachable: 2,
        topScoreWhenAnswerable: { min: 0.6, median: 0.7, max: 0.8 },
        topScoreWhenUnanswerable: { min: 0.5, median: 0.55, max: 0.6 },
      },
    };
    const row = await ctx.prisma.evalRun.findUniqueOrThrow({ where: { id: await saveRun(d, report) } });
    expect([row.hitRate1, row.hitRate3, row.hitRate5, row.mrr, row.answerableCount]).toEqual([0.25, 0.5, 0.75, 0.4, 8]);
    expect(row.questionCount).toBe(1); // questions run, which is not the same as answerable ones
    expect(row.config).toMatchObject({
      unreachable: 2,
      topScoreWhenAnswerable: { min: 0.6, median: 0.7, max: 0.8 },
      topScoreWhenUnanswerable: { min: 0.5, median: 0.55, max: 0.6 },
    });
  });

  it("keeps each workspace's runs to itself", async () => {
    const { db: d } = await twoDocuments();
    const report = await run(d, [question("q1", ask("a", 30), [{ document: "alpha.txt", quote: line("a", 30) }])]);
    await saveRun(d, report);
    const bob = await registerUser(ctx.app, "bob@b.com", "Bob");
    expect(await db(bob.me.activeWorkspaceId!).evalRun.count()).toBe(0);
    expect(await d.evalRun.count()).toBe(1);
  });
});
