import { describe, expect, it } from "vitest";
import { estimateTokens } from "../src/chunking";
import {
  buildContext,
  buildUserPrompt,
  CONTEXT_TOKEN_BUDGET,
  type Context,
  type ContextChunk,
  parseInlineMarkers,
  parseStructuredAnswer,
  RAG_TOP_K,
  REFUSAL_PHRASE,
  SYSTEM_PROMPT,
  verifyCitations,
} from "../src/rag/prompt";

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

  it("tells the model the [N] marker convention", () => {
    expect(SYSTEM_PROMPT).toMatch(/\[N\]/);
  });
});

describe("parseStructuredAnswer (the non-streaming endpoint's structured reply)", () => {
  it("reads the answer and its citations out of a valid reply", () => {
    const reply = JSON.stringify({ answer: "Staff get 25 days [1].", citations: [{ marker: 1, sourceIndex: 1 }] });
    expect(parseStructuredAnswer(reply)).toEqual({ answer: "Staff get 25 days [1].", citations: [{ marker: 1, sourceIndex: 1 }] });
  });

  it("returns null for text that is not JSON at all, so the caller can fall back to it as a plain answer", () => {
    expect(parseStructuredAnswer("Staff get 25 days off.")).toBeNull();
  });

  it("returns null when a required field is missing", () => {
    expect(parseStructuredAnswer(JSON.stringify({ answer: "Staff get 25 days off." }))).toBeNull();
    expect(parseStructuredAnswer(JSON.stringify({ citations: [] }))).toBeNull();
  });

  it("returns null when a citation entry is malformed, rather than silently dropping it", () => {
    expect(parseStructuredAnswer(JSON.stringify({ answer: "x", citations: [{ marker: "1", sourceIndex: 1 }] }))).toBeNull();
    expect(parseStructuredAnswer(JSON.stringify({ answer: "x", citations: [{ marker: 1 }] }))).toBeNull();
  });
});

describe("parseInlineMarkers (the streaming endpoint's marker parsing)", () => {
  it("finds every [N] marker and treats N as the passage number, by convention", () => {
    expect(parseInlineMarkers("Staff get 25 days [1]. The office closes at 6pm [2].")).toEqual([
      { marker: 1, sourceIndex: 1 },
      { marker: 2, sourceIndex: 2 },
    ]);
  });

  it("does not duplicate a marker reused later in the text", () => {
    expect(parseInlineMarkers("First point [1]. Related point, same source [1].")).toEqual([{ marker: 1, sourceIndex: 1 }]);
  });

  it("returns nothing for an answer with no markers", () => {
    expect(parseInlineMarkers("Staff get 25 days off.")).toEqual([]);
  });

  it("sorts markers by number, regardless of the order they appear in the text", () => {
    expect(parseInlineMarkers("Second first [2], then first [1].").map((c) => c.marker)).toEqual([1, 2]);
  });
});

describe("verifyCitations", () => {
  const context = (usedCount: number): Context => ({ text: "", used: Array.from({ length: usedCount }, () => ({}) as ContextChunk) });

  it("marks a citation verified when its sourceIndex names a passage really in context", () => {
    expect(verifyCitations([{ marker: 1, sourceIndex: 1 }], context(3))).toEqual([{ marker: 1, sourceIndex: 1, verified: true }]);
  });

  it("marks a citation unverified, but keeps it, when its sourceIndex is out of range", () => {
    expect(verifyCitations([{ marker: 1, sourceIndex: 4 }], context(3))).toEqual([{ marker: 1, sourceIndex: 4, verified: false }]);
  });

  it("marks a citation unverified for index 0 or below, an invented reference no real numbering ever produces", () => {
    expect(verifyCitations([{ marker: 1, sourceIndex: 0 }], context(3))[0].verified).toBe(false);
  });

  it("marks every citation unverified when nothing was retrieved", () => {
    expect(verifyCitations([{ marker: 1, sourceIndex: 1 }], context(0))[0].verified).toBe(false);
  });
});
