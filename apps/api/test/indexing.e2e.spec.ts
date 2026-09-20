import { createHash, randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ChunkEmbedder } from "../src/embedding/chunk-embedder";
import { forWorkspace } from "../src/prisma/tenant-client";
import { searchChunks } from "../src/search/plain-search";
import { STORAGE, type StorageService } from "../src/storage/storage.service";
import {
  createDocumentWorker,
  createEmbeddingWorker,
} from "../src/worker/document.worker";
import { SweeperService } from "../src/worker/sweeper.service";
import { SystemQueries } from "../src/worker/system-queries";
import { providerError } from "./fake-embeddings";
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
  ctx.embeddings.reset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const storage = () => ctx.app.get<StorageService>(STORAGE);

async function storeDocument(
  workspaceId: string,
  text: string,
  name = "doc.txt",
) {
  const bytes = fixtures.txt(text);
  const id = randomUUID();
  const storageKey = `${workspaceId}/${id}`;
  await storage().put(storageKey, bytes);
  await ctx.prisma.document.create({
    data: {
      id,
      workspaceId,
      originalName: name,
      type: "TXT",
      sizeBytes: bytes.length,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      storageKey,
    },
  });
  return id;
}

async function alice() {
  const user = await registerUser(ctx.app, "alice@a.com", "Alice");
  return { ...user, wid: user.me.activeWorkspaceId! };
}

/** Stores a text file and reads it, so it is Indexing: chunks exist, no vectors yet. */
async function readDocument(wid: string, text: string, name?: string) {
  const id = await storeDocument(wid, text, name);
  expect(
    await ctx.processor.process({ documentId: id, workspaceId: wid }),
  ).toBe("indexing");
  return id;
}

// Distinct paragraphs, so every chunk has its own text. 150 paragraphs make about 25 chunks: several groups.
const bigText = (paragraphs = 150) =>
  Array.from({ length: paragraphs }, (_, i) =>
    `Paragraph ${i} covers topic number ${i * 7919} and explains one separate rule about equipment, travel or expenses in some detail.`.repeat(
      2,
    ),
  ).join("\n\n");

const documentRow = (id: string) =>
  ctx.prisma.document.findUniqueOrThrow({ where: { id } });
const chunksOf = (id: string) =>
  ctx.prisma.documentChunk.findMany({
    where: { documentId: id },
    orderBy: { chunkIndex: "asc" },
  });
const vectorCount = () => ctx.prisma.chunkEmbedding.count();
const index = (
  id: string,
  wid: string,
  attempt?: { number: number; max: number },
) => ctx.indexer.index({ documentId: id, workspaceId: wid }, attempt);

describe("DocumentIndexerService", () => {
  it("gives every chunk a vector, stores it as bytes, and marks the document Ready", async () => {
    const { wid } = await alice();
    const id = await readDocument(wid, bigText(30));
    const chunks = await chunksOf(id);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.embeddedWith === null)).toBe(true);

    expect(await index(id, wid)).toBe("ready");

    const doc = await documentRow(id);
    expect(doc).toMatchObject({ status: "READY", statusDetail: null });
    const after = await chunksOf(id);
    expect(after.every((c) => c.embeddedWith === ctx.embeddings.setupId)).toBe(
      true,
    );

    const vectors = await ctx.prisma.chunkEmbedding.findMany();
    expect(vectors).toHaveLength(
      new Set(chunks.map((c) => c.contentHash)).size,
    );
    expect(
      vectors.every(
        (v) =>
          v.workspaceId === wid &&
          v.vector.byteLength === 768 * 4 &&
          v.setupId === ctx.embeddings.setupId,
      ),
    ).toBe(true);

    // The provider saw each chunk text once, worded as a document (not as a question).
    expect(ctx.embeddings.calls.every((c) => c.purpose === "document")).toBe(
      true,
    );
    expect([...ctx.embeddings.textsSent].sort()).toEqual(
      chunks.map((c) => c.text).sort(),
    );
  });

  it("reports progress while it works: the status detail says how many chunks are done", async () => {
    const { wid } = await alice();
    const id = await readDocument(wid, bigText());
    const total = (await chunksOf(id)).length;
    expect(total).toBeGreaterThan(16); // more than one group of 16

    const seen: (string | null)[] = [];
    ctx.embeddings.beforeCall = async () => {
      seen.push((await documentRow(id)).statusDetail);
    };
    await index(id, wid);

    expect(ctx.embeddings.calls.length).toBeGreaterThan(1);
    expect(seen[0]).toBeNull();
    expect(seen[1]).toBe(`Embedding 16 of ${total} chunks`);
    expect(await documentRow(id)).toMatchObject({
      status: "READY",
      statusDetail: null,
    });
  });

  it("does nothing for a document that is not waiting for embeddings, or that does not exist, or in another workspace", async () => {
    const a = await alice();
    const bob = await registerUser(ctx.app, "bob@b.com", "Bob");
    const notRead = await storeDocument(
      a.wid,
      "Not read yet, but long enough to matter.",
    );
    const id = await readDocument(a.wid, bigText(3));

    expect(await index(notRead, a.wid)).toBe("skipped"); // still Uploaded
    expect(await index(randomUUID(), a.wid)).toBe("skipped");
    expect(await index(id, bob.me.activeWorkspaceId!)).toBe("skipped"); // wrong workspace finds nothing
    expect(ctx.embeddings.calls).toHaveLength(0);
    expect((await documentRow(id)).status).toBe("INDEXING");

    await index(id, a.wid);
    const callsAfterFirst = ctx.embeddings.calls.length;
    expect(await index(id, a.wid)).toBe("skipped"); // already Ready: a repeated delivery changes nothing
    expect(ctx.embeddings.calls).toHaveLength(callsAfterFirst);
  });

  it("never pays twice for the same text: a second document with the same paragraph reuses the vector", async () => {
    const { wid } = await alice();
    const text =
      "Visitors must be registered by their host before they arrive at the office.";
    const first = await readDocument(wid, text, "first.txt");
    await index(first, wid);
    expect(ctx.embeddings.calls).toHaveLength(1);

    const second = await readDocument(wid, text + "\n", "second.txt"); // different bytes, same chunk text
    expect(await index(second, wid)).toBe("ready");

    expect(ctx.embeddings.calls).toHaveLength(1); // no new provider call
    expect(await vectorCount()).toBe(1);
    expect((await chunksOf(second))[0].embeddedWith).toBe(
      ctx.embeddings.setupId,
    );
  });

  it("keeps the cache separate per workspace: the same text in another workspace is embedded again", async () => {
    const a = await alice();
    const bob = await registerUser(ctx.app, "bob@b.com", "Bob");
    const text =
      "Visitors must be registered by their host before they arrive at the office.";
    await index(await readDocument(a.wid, text), a.wid);
    await index(
      await readDocument(bob.me.activeWorkspaceId!, text),
      bob.me.activeWorkspaceId!,
    );

    expect(ctx.embeddings.calls).toHaveLength(2);
    expect(
      await ctx.prisma.chunkEmbedding.count({ where: { workspaceId: a.wid } }),
    ).toBe(1);
    expect(
      await ctx.prisma.chunkEmbedding.count({
        where: { workspaceId: bob.me.activeWorkspaceId! },
      }),
    ).toBe(1);
  });

  describe("when the provider fails", () => {
    it("a temporary failure is thrown so the queue retries, and the retry continues where it stopped", async () => {
      const { wid } = await alice();
      const id = await readDocument(wid, bigText());
      const total = (await chunksOf(id)).length;
      ctx.embeddings.failures = [undefined, providerError(503)]; // first call works, the second fails

      await expect(index(id, wid, { number: 1, max: 3 })).rejects.toThrow(
        "provider error 503",
      );
      const midway = await chunksOf(id);
      const done = midway.filter((c) => c.embeddedWith).length;
      expect(done).toBe(16); // the first group was kept
      expect(await documentRow(id)).toMatchObject({
        status: "INDEXING",
        statusDetail: `Embedding 16 of ${total} chunks`,
      });

      const callsBefore = ctx.embeddings.calls.length;
      expect(await index(id, wid, { number: 2, max: 3 })).toBe("ready");
      const firstGroup = new Set(
        midway.filter((c) => c.embeddedWith).map((c) => c.text),
      );
      const retryTexts = ctx.embeddings.calls
        .slice(callsBefore)
        .flatMap((c) => c.texts);
      expect(retryTexts.some((t) => firstGroup.has(t))).toBe(false); // nothing already paid for is sent again
      expect(retryTexts).toHaveLength(total - 16);
    });

    it("gives up on the last attempt with a plain reason, and Retry later only pays for what is missing", async () => {
      const a = await alice();
      const id = await readDocument(a.wid, bigText());
      const total = (await chunksOf(id)).length;
      ctx.embeddings.failures = [undefined, providerError(503)];

      expect(await index(id, a.wid, { number: 3, max: 3 })).toBe("failed");
      const failed = await documentRow(id);
      expect(failed.status).toBe("FAILED");
      expect(failed.statusDetail).toMatch(/temporary problem/);
      expect(await vectorCount()).toBe(16); // the paid vectors are still there

      // The person presses Retry: it is read again from the start, but the cache answers for the first 16.
      const retry = await a.agent.post(`/documents/${id}/retry`);
      expect(retry.status).toBe(200);
      expect(retry.body.status).toBe("UPLOADED");
      ctx.embeddings.calls = [];
      await ctx.processor.process({ documentId: id, workspaceId: a.wid });
      expect(await index(id, a.wid)).toBe("ready");
      expect(ctx.embeddings.textsSent).toHaveLength(total - 16);
    });

    it.each([
      [400, /refused the text/],
      [401, /API key/],
      [403, /API key/],
      [404, /model/],
    ])(
      "a %i from the provider can never work, so it fails at once with a reason (no retry)",
      async (status, reason) => {
        const { wid } = await alice();
        const id = await readDocument(wid, bigText(3));
        ctx.embeddings.failures = [providerError(status)];

        expect(await index(id, wid, { number: 1, max: 3 })).toBe("failed");
        const doc = await documentRow(id);
        expect(doc.status).toBe("FAILED");
        expect(doc.statusDetail).toMatch(reason);
      },
    );

    it("is quietly skipped if the document is deleted while it is being embedded", async () => {
      const { wid } = await alice();
      const id = await readDocument(wid, bigText());
      ctx.embeddings.beforeCall = async () => {
        await ctx.prisma.document.deleteMany({ where: { id } });
      };
      expect(await index(id, wid)).toBe("skipped");
    });
  });

  it("treats a new model, size or wording as work to do: vectors of the old setup are not used", async () => {
    const a = await alice();
    const id = await readDocument(a.wid, bigText(20));
    await index(id, a.wid);
    const total = (await chunksOf(id)).length;
    const listed = async () =>
      (
        (await a.agent.get("/documents")).body as {
          id: string;
          chunkCount: number;
          embeddedCount: number;
        }[]
      ).find((d) => d.id === id)!;
    expect(await listed()).toMatchObject({
      chunkCount: total,
      embeddedCount: total,
    });

    ctx.embeddings.setupId = "fake-embedding|768|w2"; // for example, someone edited the wording
    expect(await listed()).toMatchObject({
      chunkCount: total,
      embeddedCount: 0,
    });

    await ctx.prisma.document.update({
      where: { id },
      data: { status: "INDEXING" },
    });
    ctx.embeddings.calls = [];
    expect(await index(id, a.wid)).toBe("ready");
    expect(ctx.embeddings.textsSent).toHaveLength(total); // everything embedded again
    expect(await listed()).toMatchObject({ embeddedCount: total });
    expect(await vectorCount()).toBe(total * 2); // old vectors are kept, under their own setup id
  });
});

describe("what the API shows", () => {
  it("says per chunk whether it has a vector, and how many of a document's chunks do", async () => {
    const a = await alice();
    const id = await readDocument(a.wid, bigText(30));
    const before = await a.agent.get(`/documents/${id}/chunks`);
    expect(before.body.document.embeddedCount).toBe(0);
    expect(
      before.body.chunks.every(
        (c: { embedded: boolean }) => c.embedded === false,
      ),
    ).toBe(true);

    await index(id, a.wid);
    const after = await a.agent.get(`/documents/${id}/chunks`);
    expect(after.body.document).toMatchObject({
      status: "READY",
      embeddedCount: after.body.chunks.length,
    });
    expect(
      after.body.chunks.every(
        (c: { embedded: boolean }) => c.embedded === true,
      ),
    ).toBe(true);
  });
});

describe("deleting a document deletes its vectors", () => {
  it("removes the vectors of its texts, but keeps one that another document still uses", async () => {
    const a = await alice();
    const shared =
      "Visitors must be registered by their host before they arrive at the office.";
    const one = await readDocument(a.wid, shared, "one.txt");
    const two = await readDocument(a.wid, shared + "\n", "two.txt");
    const unique = await readDocument(
      a.wid,
      "Parking spaces are allocated by a monthly draw and cannot be swapped.",
      "unique.txt",
    );
    for (const id of [one, two, unique]) await index(id, a.wid);
    expect(await vectorCount()).toBe(2); // the shared text has one vector

    expect((await a.agent.delete(`/documents/${unique}`)).status).toBe(204);
    expect(await vectorCount()).toBe(1);
    expect((await a.agent.delete(`/documents/${one}`)).status).toBe(204);
    expect(await vectorCount()).toBe(1); // still used by two.txt
    expect((await a.agent.delete(`/documents/${two}`)).status).toBe(204);
    expect(await vectorCount()).toBe(0);
  });
});

describe("plain search", () => {
  const topics = {
    leave:
      "Employees receive twenty five days of paid annual leave every calendar year. Unused leave carries over until March.",
    parking:
      "Staff parking spaces are allocated by a monthly draw. Bicycle storage is free and needs no booking.",
    travel:
      "Flights and hotels are booked through the company travel desk. Hotel stays are reimbursed up to a fixed nightly limit.",
  };

  async function withTopics(wid: string) {
    const ids: Record<string, string> = {};
    for (const [name, text] of Object.entries(topics)) {
      ids[name] = await readDocument(wid, text, `${name}.txt`);
      await index(ids[name], wid);
    }
    return ids;
  }

  it("ranks the chunk that is closest to the question first, with its document, page and score", async () => {
    const a = await alice();
    const ids = await withTopics(a.wid);
    const db = forWorkspace(ctx.prisma, a.wid);

    ctx.embeddings.calls = [];
    const hits = await searchChunks(
      db,
      ctx.embeddings,
      "paragraph",
      "how many days of annual leave do employees receive",
      3,
    );

    expect(ctx.embeddings.calls).toEqual([
      {
        texts: ["how many days of annual leave do employees receive"],
        purpose: "query",
      },
    ]);
    expect(hits).toHaveLength(3);
    expect(hits[0]).toMatchObject({
      documentId: ids.leave,
      documentName: "leave.txt",
      pageNumber: 1,
      chunkIndex: 0,
    });
    expect(hits[0].text).toContain("annual leave");
    expect(hits.map((h) => h.score)).toEqual(
      [...hits.map((h) => h.score)].sort((x, y) => y - x),
    );
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
    expect(
      await searchChunks(db, ctx.embeddings, "paragraph", "annual leave", 1),
    ).toHaveLength(1);
  });

  it("only sees its own workspace, even when another workspace has the closer text", async () => {
    const a = await alice();
    const bob = await registerUser(ctx.app, "bob@b.com", "Bob");
    const bw = bob.me.activeWorkspaceId!;
    await withTopics(a.wid);
    await index(
      await readDocument(
        bw,
        "Bob's secret: annual leave for the whole board is fifty days.",
        "bob.txt",
      ),
      bw,
    );

    const hits = await searchChunks(
      forWorkspace(ctx.prisma, a.wid),
      ctx.embeddings,
      "paragraph",
      "annual leave for the board fifty days",
      10,
    );
    expect(hits.map((h) => h.documentName).sort()).toEqual([
      "leave.txt",
      "parking.txt",
      "travel.txt",
    ]);
    expect(hits.some((h) => h.text.includes("secret"))).toBe(false);
  });

  it("finds only Ready documents, and only vectors made under the current setup", async () => {
    const a = await alice();
    await withTopics(a.wid);
    const db = forWorkspace(ctx.prisma, a.wid);
    // A document part way through Indexing: its chunks already have vectors, but it is not Ready yet.
    const waiting = await readDocument(
      a.wid,
      "Annual leave requests for waiting documents are not searchable yet.",
      "waiting.txt",
    );
    await new ChunkEmbedder(ctx.embeddings, "paragraph").embedDocument(
      db,
      waiting,
    );
    expect((await documentRow(waiting)).status).toBe("INDEXING");
    expect((await chunksOf(waiting))[0].embeddedWith).toBe(
      ctx.embeddings.setupId,
    );

    const hits = await searchChunks(
      db,
      ctx.embeddings,
      "paragraph",
      "annual leave",
      10,
    );
    expect(hits.some((h) => h.documentId === waiting)).toBe(false);
    expect(hits).toHaveLength(3);

    ctx.embeddings.setupId = "fake-embedding|768|w2";
    expect(
      await searchChunks(db, ctx.embeddings, "paragraph", "annual leave", 10),
    ).toEqual([]);
  });
});

describe("the pipeline through both queues", () => {
  let running: { close(): Promise<void> }[] = [];
  afterEach(async () => {
    await Promise.all(running.map((w) => w.close()));
    running = [];
  });
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const startReader = () =>
    running.push(
      createDocumentWorker({
        processor: ctx.processor,
        redisUrl,
        prefix: TEST_QUEUE_PREFIX,
        concurrency: 1,
        timeoutSeconds: 60,
      }),
    );
  const startEmbedder = () =>
    running.push(
      createEmbeddingWorker({
        indexer: ctx.indexer,
        redisUrl,
        prefix: TEST_QUEUE_PREFIX,
      }),
    );

  const listed = async (
    agent: { get: (p: string) => PromiseLike<{ body: any }> },
    id: string,
  ) =>
    (
      (await agent.get("/documents")).body as {
        id: string;
        status: string;
        chunkCount: number;
        embeddedCount: number;
        statusDetail: string | null;
      }[]
    ).find((d) => d.id === id);

  it("an uploaded file goes Uploaded, Indexing, Ready by itself, and every chunk has a vector", async () => {
    const { agent } = await alice();
    startReader();
    startEmbedder();

    const res = await upload(agent, fixtures.txt(bigText(20)), "policy.txt");
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("UPLOADED");

    const ready = await waitFor(async () => {
      const d = await listed(agent, res.body.id);
      return d?.status === "READY" ? d : false;
    });
    expect(ready.chunkCount).toBeGreaterThan(2);
    expect(ready).toMatchObject({
      embeddedCount: ready.chunkCount,
      statusDetail: null,
    });
  });

  it("with only the reading worker running, the document waits in Indexing, and starts when the embedding worker comes", async () => {
    const { agent } = await alice();
    startReader();
    const res = await upload(agent, fixtures.txt(bigText(20)), "policy.txt");
    await waitFor(async () =>
      (await listed(agent, res.body.id))?.status === "INDEXING" ? true : false,
    );
    expect((await ctx.queue.countsEmbedding()).waiting).toBe(1); // the job waits in the queue

    startEmbedder();
    await waitFor(async () =>
      (await listed(agent, res.body.id))?.status === "READY" ? true : false,
    );
  });

  it("reading queues the embedding job, and a failure to queue it does not undo the reading", async () => {
    const { wid } = await alice();
    const id = await storeDocument(wid, bigText(3));
    expect(
      await ctx.processor.process({ documentId: id, workspaceId: wid }),
    ).toBe("indexing");
    expect((await ctx.queue.countsEmbedding()).waiting).toBe(1);

    const other = await storeDocument(wid, bigText(4));
    vi.spyOn(ctx.queue, "enqueueEmbedding").mockRejectedValue(
      new Error("redis is down"),
    );
    expect(
      await ctx.processor.process({ documentId: other, workspaceId: wid }),
    ).toBe("indexing");
    expect((await documentRow(other)).status).toBe("INDEXING"); // the sweeper will find it
  });

  it("the sweeper queues a stuck Indexing document for embedding, and a stuck Uploaded one for reading", async () => {
    const { wid } = await alice();
    const uploaded = await storeDocument(
      wid,
      "A note that was never queued, long enough.",
      "a.txt",
    );
    const indexing = await readDocument(wid, bigText(3), "b.txt");
    const longAgo = new Date(Date.now() - 10 * 60_000);
    await ctx.prisma.document.updateMany({
      where: { id: { in: [uploaded, indexing] } },
      data: { updatedAt: longAgo },
    });
    await ctx.queue.clear(); // forget the jobs the reading created

    expect(
      await new SweeperService(
        new SystemQueries(ctx.prisma),
        ctx.queue,
      ).runOnce(),
    ).toBe(2);
    expect((await ctx.queue.counts()).waiting).toBe(1);
    expect((await ctx.queue.countsEmbedding()).waiting).toBe(1);
  });
});
