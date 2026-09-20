import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { GeminiEmbeddingClient } from "../src/llm/gemini/gemini-embedding-client";
import { decodeVector, encodeVector } from "../src/embedding/vector";
import { estimateTokensForLimiter } from "../src/llm/tokens";
import { RateLimiter, TokenLimiter } from "../src/llm/resilience";
import { cosine, rankBySimilarity } from "../src/search/similarity";

describe("estimateTokensForLimiter", () => {
  it("assumes 3 characters per token, rounded up (more cautious than the 4 used for chunk sizes)", () => {
    expect(estimateTokensForLimiter("")).toBe(0);
    expect(estimateTokensForLimiter("abc")).toBe(1);
    expect(estimateTokensForLimiter("abcd")).toBe(2);
    expect(estimateTokensForLimiter("x".repeat(2000))).toBe(667);
  });
});

describe("TokenLimiter", () => {
  // A fake clock: waiting just moves time forward, so nothing really sleeps.
  function fakeClock() {
    const clock = { t: 0, waits: [] as number[] };
    const wait = async (ms: number) => {
      clock.waits.push(ms);
      clock.t += ms;
    };
    return { clock, now: () => clock.t, wait };
  }

  it("lets requests through while they fit in the budget", async () => {
    const { clock, now, wait } = fakeClock();
    const limiter = new TokenLimiter(1000, now, wait);
    await limiter.acquire(600);
    await limiter.acquire(300);
    expect(clock.waits).toEqual([]);
  });

  it("waits until enough earlier tokens have left the 60 second window", async () => {
    const { clock, now, wait } = fakeClock();
    const limiter = new TokenLimiter(1000, now, wait);
    await limiter.acquire(600); // at 0 s
    await limiter.acquire(300);
    await limiter.acquire(300); // needs 200 more room: the 600 at 0 s must expire first
    expect(clock.waits).toEqual([60_005]);
    expect(clock.t).toBe(60_005);
  });

  it("waits only as long as needed when a later entry is enough", async () => {
    const { clock, now, wait } = fakeClock();
    const limiter = new TokenLimiter(1000, now, wait);
    await limiter.acquire(400); // at 0 s
    clock.t = 30_000;
    await limiter.acquire(400); // at 30 s
    await limiter.acquire(500); // needs 300 room: the first 400 frees it at 60 s
    expect(clock.waits).toEqual([30_005]);
  });

  it("lets a request bigger than the whole budget through once the window is empty, instead of waiting forever", async () => {
    const { clock, now, wait } = fakeClock();
    const limiter = new TokenLimiter(1000, now, wait);
    await limiter.acquire(5000);
    expect(clock.waits).toEqual([]);
    await limiter.acquire(1); // the oversized one used the whole budget
    expect(clock.waits).toEqual([60_005]);
  });

  it("never grants more than the budget in any 60 second window (200 random requests)", async () => {
    const { clock, now, wait } = fakeClock();
    const budget = 3000;
    const limiter = new TokenLimiter(budget, now, wait);
    let seed = 7;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const grants: { at: number; tokens: number }[] = [];
    for (let i = 0; i < 200; i++) {
      const tokens = 1 + Math.floor(rand() * 1500);
      await limiter.acquire(tokens);
      grants.push({ at: clock.t, tokens: Math.min(tokens, budget) });
      clock.t += Math.floor(rand() * 4000); // time passes between requests
    }
    for (const g of grants) {
      const inWindow = grants.filter((h) => h.at <= g.at && g.at - h.at < 60_000).reduce((n, h) => n + h.tokens, 0);
      expect(inWindow, `window ending at ${g.at}`).toBeLessThanOrEqual(budget);
    }
  });
});

describe("vector storage", () => {
  it("round-trips a vector through bytes", () => {
    const original = Array.from({ length: 768 }, (_, i) => Math.sin(i) / 3);
    const bytes = encodeVector(original);
    expect(bytes.byteLength).toBe(768 * 4);
    const back = decodeVector(bytes, 768);
    original.forEach((v, i) => expect(back[i]).toBeCloseTo(v, 6));
  });

  it("decodes bytes that do not start on a 4-byte boundary (as database buffers may)", () => {
    const original = [0.5, -0.25, 0.125, 1];
    const shifted = Buffer.concat([Buffer.from([9]), encodeVector(original)]).subarray(1);
    expect(Array.from(decodeVector(shifted, 4))).toEqual(original);
  });

  it("refuses bytes of the wrong length instead of returning nonsense", () => {
    expect(() => decodeVector(encodeVector([1, 2, 3]), 4)).toThrow(/expected 4/);
  });
});

describe("cosine and rankBySimilarity", () => {
  it("is 1 for the same direction, 0 for unrelated, -1 for opposite, and ignores length", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1, 10);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 10);
    expect(cosine([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1, 10);
    expect(cosine([1, 2, 3], [10, 20, 30])).toBeCloseTo(1, 10);
  });

  it("gives 0 for an all-zero vector, and refuses vectors of different lengths", () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(() => cosine([1, 2], [1, 2, 3])).toThrow(/length/);
  });

  it("returns the closest k, best first, with their scores, and keeps input order on ties", () => {
    const items = [
      { id: "far", vector: [0, 1] },
      { id: "near", vector: [1, 0.1] },
      { id: "same-a", vector: [1, 0] },
      { id: "same-b", vector: [2, 0] },
    ];
    const top = rankBySimilarity([1, 0], items, 3);
    expect(top.map((t) => t.id)).toEqual(["same-a", "same-b", "near"]);
    expect(top[0].score).toBeCloseTo(1, 10);
    expect(top[2].score).toBeLessThan(top[1].score);
    expect(rankBySimilarity([1, 0], items, 0)).toEqual([]);
    expect(rankBySimilarity([1, 0], items, 99)).toHaveLength(4);
  });

  it("works on decoded stored vectors", () => {
    const stored = [encodeVector([1, 0, 0]), encodeVector([0, 1, 0])].map((b, i) => ({ id: i, vector: decodeVector(b, 3) }));
    expect(rankBySimilarity(Float32Array.from([0, 1, 0]), stored, 1)[0].id).toBe(1);
  });
});

describe("GeminiEmbeddingClient (the provider call is replaced, so nothing leaves this machine)", () => {
  function makeClient(model = "gemini-embedding-2", dimensions = 768) {
    const tokenLimiter = new TokenLimiter(30_000);
    const acquire = vi.spyOn(tokenLimiter, "acquire");
    const usage = { record: vi.fn() };
    const client = new GeminiEmbeddingClient({
      apiKey: "not-a-real-key",
      model,
      dimensions,
      maxRetries: 2,
      limiter: new RateLimiter(1000),
      tokenLimiter,
      usage,
    });
    const embedContent = vi.fn(async ({ contents }: { contents: unknown[] }) => ({
      embeddings: contents.map(() => ({ values: new Array<number>(dimensions).fill(0.01) })),
    }));
    (client as unknown as { ai: { models: { embedContent: typeof embedContent } } }).ai.models.embedContent = embedContent;
    return { client, acquire, embedContent, usage };
  }
  const textOfCall = (call: unknown[]) => (call[0] as { contents: { parts: { text: string }[] }[] }).contents.map((c) => c.parts[0].text);

  it("splits a big request into calls of about 10,000 estimated tokens, one vector back per text, in order", async () => {
    const { client, embedContent } = makeClient();
    const texts = Array.from({ length: 5 }, (_, i) => String(i).repeat(12_000)); // 4,000 estimated tokens each
    const vectors = await client.embed(texts, "document");

    expect(vectors).toHaveLength(5);
    expect(embedContent.mock.calls.map((c) => textOfCall(c).length)).toEqual([2, 2, 1]);
    // Each text stays its own content entry, and the order is kept.
    const sent = embedContent.mock.calls.flatMap(textOfCall);
    sent.forEach((text, i) => expect(text.endsWith(texts[i])).toBe(true));
  });

  it("spends the token budget for the text actually sent, including the instruction added in front of it", async () => {
    const { client, acquire, embedContent } = makeClient();
    await client.embed(["abc".repeat(100)], "document");
    const sent = textOfCall(embedContent.mock.calls[0])[0];
    expect(sent.length).toBeGreaterThan(300); // the instruction is part of what is sent
    expect(acquire).toHaveBeenCalledWith(estimateTokensForLimiter(sent));
  });

  it("spends the budget again on every attempt: a retry is a real call to the provider", async () => {
    const { client, acquire, embedContent } = makeClient();
    embedContent.mockRejectedValueOnce(Object.assign(new Error("try later"), { status: 503 }));
    await client.embed(["some chunk text"], "document");
    expect(embedContent).toHaveBeenCalledTimes(2);
    expect(acquire).toHaveBeenCalledTimes(2);
  });

  it("does not retry a request that can never work, and reports how many attempts it took", async () => {
    const { client, embedContent, usage } = makeClient();
    embedContent.mockRejectedValue(Object.assign(new Error("bad request"), { status: 400 }));
    await expect(client.embed(["text"], "document")).rejects.toThrow("bad request");
    expect(embedContent).toHaveBeenCalledTimes(1);
    expect(usage.record).toHaveBeenCalledWith(expect.objectContaining({ operation: "embed", ok: false, attempts: 1 }));
  });

  it("fingerprints the exact wording, so editing the instruction text is a conscious decision (vectors must be made again)", () => {
    // If this fails, someone changed how texts are worded for the model. That is allowed, but every stored vector
    // was made with the old wording: update this expected text on purpose, and expect documents to be embedded again.
    const wording = "title: none | text: x\ntask: search result | query: x";
    const expected = createHash("sha256").update(wording).digest("hex").slice(0, 8);
    expect(makeClient("gemini-embedding-2", 768).client.setupId).toBe(`gemini-embedding-2|768|${expected}`);
  });

  it("names its setup with the model, the dimensions and a fingerprint of the wording", () => {
    const a = makeClient("gemini-embedding-2", 768).client;
    expect(a.setupId).toMatch(/^gemini-embedding-2\|768\|[0-9a-f]{8}$/);
    expect(makeClient("gemini-embedding-2", 768).client.setupId).toBe(a.setupId); // stable
    expect(makeClient("gemini-embedding-2", 1536).client.setupId).not.toBe(a.setupId);
    expect(makeClient("gemini-embedding-other", 768).client.setupId).not.toBe(a.setupId);
    expect(makeClient("gemini-embedding-001", 768).client.setupId).toMatch(/\|[0-9a-f]{8}$/); // uses a task type instead of wording
  });
});
