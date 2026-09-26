import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ENV } from "../src/config/config.module";
import type { Env } from "../src/config/env";
import { TenantPrismaService } from "../src/prisma/tenant-prisma.service";
import { CITATION_RESPONSE_SCHEMA, MAX_OUTPUT_TOKENS, NOT_FOUND_ANSWER, REFUSAL_PHRASE, SYSTEM_PROMPT, TEMPERATURE } from "../src/rag/prompt";
import { RagService } from "../src/rag/rag.service";
import { STORAGE, type StorageService } from "../src/storage/storage.service";
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
  ctx.embeddings.reset();
  ctx.llm.reset();
});

const storage = () => ctx.app.get<StorageService>(STORAGE);

/** Reads, embeds and indexes a document the way the workers do, so it is Ready and searchable. */
async function readyDocument(workspaceId: string, text: string, name = "handbook.txt") {
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

const ask = (a: ReturnType<typeof agent>, question: string) => a.post("/ask").send({ question });
const askStream = (a: ReturnType<typeof agent>, question: string) => a.get("/ask/stream").query({ question });

/** Splits raw `text/event-stream` text into { type, data } records, one per event, in order. */
function parseSse(raw: string): { type: string; data: unknown }[] {
  return raw
    .split("\n\n")
    .filter((block) => block.trim())
    .map((block) => {
      const type = /^event: (.*)$/m.exec(block)?.[1] ?? "message";
      const dataLines = [...block.matchAll(/^data: (.*)$/gm)].map((m) => m[1]);
      return { type, data: dataLines.length ? JSON.parse(dataLines.join("\n")) : undefined };
    });
}

describe("asking a question", () => {
  it("answers from this workspace's documents, passing the fixed prompt shape and settings to the model", async () => {
    const { agent: a, me } = await registerUser(ctx.app, "alice@a.com", "Alice");
    const wid = me.activeWorkspaceId!;
    await readyDocument(wid, "Full-time employees get 25 days of paid annual leave.");

    ctx.llm.replies = ["Full-time staff get 25 days."];
    const res = await ask(a, "How many days of annual leave do full-time employees get?");

    expect(res.status).toBe(201); // POST with no @HttpCode override, Nest's default for POST
    expect(res.body).toMatchObject({ answer: "Full-time staff get 25 days.", noAnswer: false });
    expect(res.body.sources).toHaveLength(1);
    expect(res.body.sources[0]).toMatchObject({ documentName: "handbook.txt", pageNumber: 1, chunkIndex: 0 });
    expect(res.body.usage).toMatchObject({ model: ctx.llm.model });
    expect(res.body.usage.retrievalMs).toBeGreaterThanOrEqual(0);
    expect(res.body.usage.generationMs).toBeGreaterThanOrEqual(0);
    expect(res.body.usage.inputTokens).toBeGreaterThan(0);
    expect(res.body.usage.outputTokens).toBeGreaterThan(0);

    expect(ctx.llm.calls).toHaveLength(1);
    const call = ctx.llm.calls[0];
    expect(call.system).toBe(SYSTEM_PROMPT);
    expect(call.temperature).toBe(TEMPERATURE);
    expect(call.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
    expect(call.thinking).toBe("minimal");
    expect(call.prompt).toContain("Full-time employees get 25 days of paid annual leave.");
    expect(call.prompt).toContain("How many days of annual leave do full-time employees get?");
    expect(call.prompt).toContain("handbook.txt");
  });

  it("never returns another workspace's chunks as sources, and never sends their text to the model", async () => {
    const alice = await registerUser(ctx.app, "alice@a.com", "Alice");
    const aliceDoc = await readyDocument(alice.me.activeWorkspaceId!, "Full-time employees get 25 days of paid annual leave.", "alice.txt");
    const bob = await registerUser(ctx.app, "bob@b.com", "Bob");
    await readyDocument(bob.me.activeWorkspaceId!, "Remote workers must use a company VPN at all times.", "bob.txt");

    const res = await ask(bob.agent, "What is the policy?");
    expect(res.status).toBe(201);
    for (const source of res.body.sources) expect(source.documentName).not.toBe("alice.txt");
    expect(ctx.llm.calls.at(-1)!.prompt).not.toContain("annual leave");
    expect(ctx.llm.calls.at(-1)!.prompt).not.toContain("alice.txt");

    // and the chunk really does belong to Bob's own document, not just "not Alice's by name"
    const aliceChunkIds = new Set((await ctx.prisma.documentChunk.findMany({ where: { documentId: aliceDoc }, select: { id: true } })).map((c) => c.id));
    for (const source of res.body.sources) expect(aliceChunkIds.has(source.chunkId)).toBe(false);
  });

  it("skips the model call entirely when there is nothing to retrieve", async () => {
    const { agent: a } = await registerUser(ctx.app, "alice@a.com", "Alice"); // no documents uploaded
    const res = await ask(a, "How many vacation days do I get?");

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ answer: NOT_FOUND_ANSWER, noAnswer: true, citations: [], sources: [] });
    expect(res.body.usage).toMatchObject({ generationMs: 0, inputTokens: null, outputTokens: null, thoughtTokens: null });
    expect(ctx.llm.calls).toHaveLength(0); // no provider call paid for an answer we already knew
  });

  it("detects the model's own refusal and reports noAnswer, while still retrieving and returning nothing misleading", async () => {
    const { agent: a, me } = await registerUser(ctx.app, "alice@a.com", "Alice");
    await readyDocument(me.activeWorkspaceId!, "Full-time employees get 25 days of paid annual leave.");
    ctx.llm.replies = [REFUSAL_PHRASE];

    const res = await ask(a, "What is the parking policy?");
    expect(res.status).toBe(201);
    expect(res.body.noAnswer).toBe(true);
    expect(res.body.answer).toBe(REFUSAL_PHRASE);
    expect(ctx.llm.calls).toHaveLength(1); // it was retrieved and asked about, unlike the empty-workspace case
  });

  it("rejects a missing, empty or far too long question before any retrieval or model call", async () => {
    const { agent: a } = await registerUser(ctx.app, "alice@a.com", "Alice");
    for (const body of [{}, { question: "" }, { question: "hi" }, { question: "x".repeat(1001) }]) {
      const res = await a.post("/ask").send(body);
      expect(res.status).toBe(400);
    }
    expect(ctx.llm.calls).toHaveLength(0);
  });

  it("requires a session, like every other tenant route", async () => {
    const res = await ask(agent(ctx.app), "How many vacation days do I get?");
    expect(res.status).toBe(401);
  });

  it("never reports a source, or sends its text to the model, once the context budget has dropped it", async () => {
    // A real budget (4000 tokens) is deliberately hard to exceed with 5 real chunks (see prompt.ts), so this
    // constructs a RagService directly with a tiny one, to prove the dropped hit is dropped everywhere: not
    // just from the prompt (already unit-tested in rag-prompt.spec.ts), but from the sources the API returns.
    const { agent: a, me } = await registerUser(ctx.app, "alice@a.com", "Alice");
    const wid = me.activeWorkspaceId!;
    await readyDocument(wid, "The office espresso machine needs descaling every 3 months.", "kitchen.txt");
    await readyDocument(wid, "Full-time employees get 25 days of paid annual leave.", "handbook.txt");

    const tinyBudget = new RagService(ctx.app.get(TenantPrismaService), ctx.vectorIndex, ctx.embeddings, ctx.llm, ctx.app.get(ENV) as Env, 15);
    const actor = { userId: me.user.id, workspaceId: wid, role: "OWNER" as const };
    const result = await tinyBudget.answer(actor, "How many days of annual leave do employees get, and how often is the espresso machine descaled?");

    expect(result.sources).toHaveLength(1); // one passage fits in 15 tokens, not both
    const kept = result.sources[0].documentName;
    const dropped = kept === "handbook.txt" ? "kitchen.txt" : "handbook.txt";
    expect(ctx.llm.calls.at(-1)!.prompt).not.toContain(dropped);
  });

  it("returns a source's passage text, so the source panel has something to show and highlight", async () => {
    const { agent: a, me } = await registerUser(ctx.app, "alice@a.com", "Alice");
    await readyDocument(me.activeWorkspaceId!, "Full-time employees get 25 days of paid annual leave.");
    ctx.llm.replies = ["Full-time staff get 25 days."];

    const res = await ask(a, "How many days of annual leave do full-time employees get?");
    expect(res.body.sources[0].text).toBe("Full-time employees get 25 days of paid annual leave.");
  });

  it("requests structured, schema-forced output, so the reply is a citation mapping rather than free text to parse", async () => {
    const { agent: a, me } = await registerUser(ctx.app, "alice@a.com", "Alice");
    await readyDocument(me.activeWorkspaceId!, "Full-time employees get 25 days of paid annual leave.");

    await ask(a, "How many days of annual leave do full-time employees get?");
    expect(ctx.llm.calls.at(-1)!.responseSchema).toEqual(CITATION_RESPONSE_SCHEMA);
  });

  it("reads citations out of a structured reply, verifying each one against the passages really sent to the model", async () => {
    const { agent: a, me } = await registerUser(ctx.app, "alice@a.com", "Alice");
    await readyDocument(me.activeWorkspaceId!, "Full-time employees get 25 days of paid annual leave.");
    ctx.llm.replies = [
      JSON.stringify({
        answer: "Full-time staff get 25 days [1]. They also get a birthday off [2].",
        citations: [
          { marker: 1, sourceIndex: 1 }, // real: passage 1 was really sent
          { marker: 2, sourceIndex: 2 }, // invented: only one passage was ever sent
        ],
      }),
    ];

    const res = await ask(a, "How many days of annual leave do full-time employees get?");
    expect(res.body.answer).toBe("Full-time staff get 25 days [1]. They also get a birthday off [2].");
    expect(res.body.citations).toEqual([
      { marker: 1, sourceIndex: 1, verified: true },
      { marker: 2, sourceIndex: 2, verified: false }, // kept, not dropped, just marked unverified
    ]);
  });

  it("falls back to the raw reply as a plain, uncited answer when the structured reply cannot be parsed", async () => {
    const { agent: a, me } = await registerUser(ctx.app, "alice@a.com", "Alice");
    await readyDocument(me.activeWorkspaceId!, "Full-time employees get 25 days of paid annual leave.");
    ctx.llm.replies = ["Full-time staff get 25 days."]; // not JSON at all

    const res = await ask(a, "How many days of annual leave do full-time employees get?");
    expect(res.body.answer).toBe("Full-time staff get 25 days.");
    expect(res.body.citations).toEqual([]);
  });
});

describe("asking a question, streamed", () => {
  it("streams the answer as delta events, then one done event with the same shape the plain endpoint returns", async () => {
    const { agent: a, me } = await registerUser(ctx.app, "alice@a.com", "Alice");
    await readyDocument(me.activeWorkspaceId!, "Full-time employees get 25 days of paid annual leave.");
    ctx.llm.replies = ["Full-time staff get 25 days."];

    const res = await askStream(a, "How many days of annual leave do full-time employees get?");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");

    const events = parseSse(res.text);
    // A status event marks retrieving, then generating, before any text: real generation calls can take far
    // longer than retrieval, and the UI needs to say so instead of still claiming to be "searching".
    expect(events[0]).toMatchObject({ type: "status", data: { status: "retrieving" } });
    expect(events[1]).toMatchObject({ type: "status", data: { status: "generating" } });

    const middle = events.slice(2, -1);
    expect(middle.length).toBeGreaterThan(1); // more than one delta, or streaming bought nothing
    for (const e of middle) expect(e.type).toBe("delta");
    const deltas = middle.map((e) => (e.data as { text: string }).text);
    expect(deltas.join("")).toBe("Full-time staff get 25 days."); // the words, back together, are the whole answer

    const done = events.at(-1)!;
    expect(done.type).toBe("done");
    expect(done.data).toMatchObject({ answer: "Full-time staff get 25 days.", noAnswer: false });
    expect((done.data as { sources: unknown[] }).sources).toHaveLength(1);
  });

  it("streams the not-found answer as a single delta after a retrieving status, with no model call and no generating status", async () => {
    const { agent: a } = await registerUser(ctx.app, "alice@a.com", "Alice"); // no documents

    const events = parseSse((await askStream(a, "How many vacation days do I get?")).text);
    expect(events.map((e) => e.type)).toEqual(["status", "delta", "done"]);
    expect(events[0].data).toMatchObject({ status: "retrieving" });
    expect((events[1].data as { text: string }).text).toBe(NOT_FOUND_ANSWER);
    expect(events[2].data).toMatchObject({ noAnswer: true, citations: [], sources: [] });
    expect(ctx.llm.calls).toHaveLength(0); // "generating" never happens: there was nothing to generate from
  });

  it("turns a failure to open the stream into a clean, distinctly-named event instead of a broken connection", async () => {
    const { agent: a, me } = await registerUser(ctx.app, "alice@a.com", "Alice");
    await readyDocument(me.activeWorkspaceId!, "Full-time employees get 25 days of paid annual leave.");
    ctx.llm.failures = [Object.assign(new Error("provider unavailable"), { status: 503 })];

    const events = parseSse((await askStream(a, "How many days of leave?")).text);
    // retrieving, generating, then the failure: retrieval succeeded (there was something to generate from), so
    // both status events fire before the model call itself fails.
    expect(events.map((e) => e.type)).toEqual(["status", "status", "failed"]);
    // Named "failed", not "error": EventSource reserves "error" for its own connection failures, dispatched
    // with no .data, to the same listener a server-sent "error" event would reach. A real failure must stay
    // distinguishable from a dropped connection on the browser side.
    expect((events.at(-1)!.data as { message: string }).message).toContain("provider unavailable");
  });

  it("does not request structured output: JSON cannot be safely parsed mid-stream", async () => {
    const { agent: a, me } = await registerUser(ctx.app, "alice@a.com", "Alice");
    await readyDocument(me.activeWorkspaceId!, "Full-time employees get 25 days of paid annual leave.");

    await askStream(a, "How many days of annual leave do full-time employees get?");
    expect(ctx.llm.calls.at(-1)!.responseSchema).toBeUndefined();
  });

  it("parses [N] markers out of the completed streamed text into the same verified citation shape", async () => {
    const { agent: a, me } = await registerUser(ctx.app, "alice@a.com", "Alice");
    await readyDocument(me.activeWorkspaceId!, "Full-time employees get 25 days of paid annual leave.");
    // A real marker [1], an invented one [3] (only one passage was ever sent), and [1] repeated later.
    ctx.llm.replies = ["Full-time staff get 25 days [1]. This is not in the handbook [3], but here it is again [1]."];

    const events = parseSse((await askStream(a, "How many days of annual leave do full-time employees get?")).text);
    const done = events.at(-1)!;
    expect(done.data).toMatchObject({
      citations: [
        { marker: 1, sourceIndex: 1, verified: true },
        { marker: 3, sourceIndex: 3, verified: false },
      ],
    });
  });

  it("validates the question the same way as the plain endpoint, before opening the stream", async () => {
    const { agent: a } = await registerUser(ctx.app, "alice@a.com", "Alice");
    const res = await a.get("/ask/stream").query({ question: "hi" });
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).not.toContain("text/event-stream");
  });

  it("requires a session, like the plain endpoint", async () => {
    const res = await askStream(agent(ctx.app), "How many vacation days do I get?");
    expect(res.status).toBe(401);
  });
});
