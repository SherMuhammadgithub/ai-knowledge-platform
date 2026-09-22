import { describe, expect, it } from "vitest";
import { estimateTokens } from "../src/chunking";
import { buildContext, buildUserPrompt, CONTEXT_TOKEN_BUDGET, RAG_TOP_K, REFUSAL_PHRASE, SYSTEM_PROMPT, type ContextChunk } from "../src/rag/prompt";

const hit = (over: Partial<ContextChunk> = {}): ContextChunk => ({
  score: 0.7,
  chunkId: "chunk-1",
  documentId: "doc-1",
  documentName: "handbook.txt",
  pageNumber: 1,
  chunkIndex: 0,
  text: "Full-time employees get 25 days of paid annual leave.",
  ...over,
});

describe("buildContext", () => {
  it("returns nothing for no hits", () => {
    expect(buildContext([], CONTEXT_TOKEN_BUDGET)).toEqual({ text: "", used: [] });
  });

  it("numbers each passage in order and labels it with its document and page", () => {
    const hits = [hit({ chunkId: "a", documentName: "alpha.txt", pageNumber: 1, text: "Alpha text." }), hit({ chunkId: "b", documentName: "beta.txt", pageNumber: 2, text: "Beta text." })];
    const context = buildContext(hits, CONTEXT_TOKEN_BUDGET);
    expect(context.text).toBe("Passage 1 (alpha.txt, page 1):\nAlpha text.\n\nPassage 2 (beta.txt, page 2):\nBeta text.");
    expect(context.used.map((h) => h.chunkId)).toEqual(["a", "b"]);
  });

  it("keeps every hit when the total is under the budget", () => {
    const hits = Array.from({ length: 5 }, (_, i) => hit({ chunkId: `c${i}` }));
    expect(buildContext(hits, CONTEXT_TOKEN_BUDGET).used).toHaveLength(5);
  });

  it("stops adding chunks once the budget would be passed, keeping the best-scoring ones (they come first)", () => {
    const big = "word ".repeat(2000); // far bigger than the whole budget on its own
    const hits = [hit({ chunkId: "keep-1", text: "short one" }), hit({ chunkId: "keep-2", text: "short two" }), hit({ chunkId: "dropped", text: big })];
    const context = buildContext(hits, 200);
    expect(context.used.map((h) => h.chunkId)).toEqual(["keep-1", "keep-2"]);
    expect(context.text).not.toContain("dropped");
  });

  it("always includes at least the first hit, even alone it is bigger than the budget", () => {
    const big = "word ".repeat(5000);
    const context = buildContext([hit({ chunkId: "only", text: big })], 10);
    expect(context.used.map((h) => h.chunkId)).toEqual(["only"]);
    expect(estimateTokens(context.text)).toBeGreaterThan(10);
  });

  it("never reports a chunk as used that is not in the returned text", () => {
    const hits = Array.from({ length: 8 }, (_, i) => hit({ chunkId: `x${i}`, text: `distinct passage number ${i} `.repeat(40) }));
    const context = buildContext(hits, 600);
    expect(context.used.length).toBeGreaterThan(0);
    expect(context.used.length).toBeLessThan(hits.length);
    for (const used of context.used) expect(context.text).toContain(used.text);
  });
});

describe("buildUserPrompt", () => {
  it("puts the passages before the question, in a fixed shape", () => {
    expect(buildUserPrompt("How many days off?", "Passage 1 (a.txt, page 1):\nSome text.")).toBe(
      "Passages:\n\nPassage 1 (a.txt, page 1):\nSome text.\n\nQuestion: How many days off?",
    );
  });
});

describe("the constants that shape a call", () => {
  it("names the exact refusal sentence inside the system prompt, so the two can never drift apart", () => {
    expect(SYSTEM_PROMPT).toContain(REFUSAL_PHRASE);
  });

  it("ties the retrieval depth to the evaluation harness's K, on purpose", () => {
    expect(RAG_TOP_K).toBe(5);
  });
});
