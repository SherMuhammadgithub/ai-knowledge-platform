import { describe, expect, it } from "vitest";
import { chunkPages } from "../src/chunking";
import { chunkFixed } from "../src/chunking/fixed";
import { chunkParagraphs, HARD_MAX_SHARE } from "../src/chunking/paragraph";
import type { ChunkPiece, ChunkSettings } from "../src/chunking/settings";

const SMALL: ChunkSettings = { targetChars: 200, overlapChars: 40 };
const NO_OVERLAP: ChunkSettings = { targetChars: 200, overlapChars: 0 };

// A sentence of a known size (about 62 characters) so tests can reason about where chunks must break.
const sentence = (n: number) => `Sentence number ${String(n).padStart(3, "0")} says one clear thing about the topic.`;
const paragraph = (from: number, count: number) => Array.from({ length: count }, (_, i) => sentence(from + i)).join(" ");

// The rule every other part of the system relies on.
function expectExactSlices(text: string, pieces: ChunkPiece[]) {
  const bad = pieces.filter((p) => text.slice(p.startChar, p.endChar) !== p.text || p.text.length === 0 || p.text !== p.text.trim());
  expect(bad, "chunks whose text is not exactly the page slice, or empty, or padded with whitespace").toEqual([]);
}

// Every character that is not whitespace must be inside at least one chunk: chunking may not lose text.
function expectNoTextLost(text: string, pieces: ChunkPiece[]) {
  const covered = new Uint8Array(text.length);
  for (const p of pieces) covered.fill(1, p.startChar, p.endChar);
  const missing: number[] = [];
  for (let i = 0; i < text.length; i++) if (!covered[i] && !/\s/.test(text[i])) missing.push(i);
  expect(missing, "positions of characters that are in no chunk").toEqual([]);
}

describe("chunkParagraphs", () => {
  it("returns nothing for an empty or blank page", () => {
    expect(chunkParagraphs("", SMALL)).toEqual([]);
    expect(chunkParagraphs("  \n\n \t ", SMALL)).toEqual([]);
  });

  it("keeps a short page as one chunk, with no overlap", () => {
    const text = paragraph(1, 2);
    const pieces = chunkParagraphs(text, SMALL);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].text).toBe(text);
  });

  it("does not cut a paragraph that fits: with no overlap every chunk starts and ends on a paragraph edge", () => {
    // Six paragraphs of two sentences (about 125 characters): one fits in a chunk of 200, two do not.
    const paragraphs = Array.from({ length: 6 }, (_, i) => paragraph(i * 2, 2));
    const text = paragraphs.join("\n\n");
    const pieces = chunkParagraphs(text, NO_OVERLAP);

    expect(pieces).toHaveLength(6);
    pieces.forEach((p, i) => expect(p.text).toBe(paragraphs[i]));
  });

  it("splits a paragraph that is longer than the target at sentence ends", () => {
    const text = paragraph(1, 12); // about 750 characters in one paragraph
    const pieces = chunkParagraphs(text, NO_OVERLAP);

    expect(pieces.length).toBeGreaterThan(2);
    for (const p of pieces) expect(p.text.endsWith(".")).toBe(true);
    expectExactSlices(text, pieces);
    expectNoTextLost(text, pieces);
  });

  it("overlaps neighbouring chunks by whole sentences, never by more than the overlap size", () => {
    const text = paragraph(1, 12);
    const settings = { targetChars: 200, overlapChars: 70 }; // room for one 58 character sentence, not two
    const pieces = chunkParagraphs(text, settings);

    expect(pieces.length).toBeGreaterThan(3);
    for (let i = 1; i < pieces.length; i++) {
      const overlap = pieces[i - 1].endChar - pieces[i].startChar;
      expect(overlap, `chunks ${i - 1} and ${i} should overlap`).toBeGreaterThan(0);
      expect(overlap).toBeLessThanOrEqual(settings.overlapChars);
      const shared = text.slice(pieces[i].startChar, pieces[i - 1].endChar);
      expect(shared).toBe(sentence(Number(shared.slice(16, 19)))); // exactly one whole sentence is repeated
    }
  });

  it("gives no overlap when every sentence is longer than the overlap size (a known cost)", () => {
    const pieces = chunkParagraphs(paragraph(1, 12), SMALL); // overlap 40, sentences 57
    for (let i = 1; i < pieces.length; i++) expect(pieces[i].startChar).toBeGreaterThanOrEqual(pieces[i - 1].endChar);
  });

  it("does not overlap when the overlap size is zero", () => {
    const pieces = chunkParagraphs(paragraph(1, 12), NO_OVERLAP);
    for (let i = 1; i < pieces.length; i++) expect(pieces[i].startChar).toBeGreaterThanOrEqual(pieces[i - 1].endChar);
  });

  it("cuts a sentence that is longer than the target at a space, never inside a word", () => {
    const text = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ") + "."; // one 800 character sentence
    const pieces = chunkParagraphs(text, NO_OVERLAP);

    expect(pieces.length).toBeGreaterThan(3);
    for (const p of pieces) {
      expect(p.text.length).toBeLessThanOrEqual(NO_OVERLAP.targetChars);
      expect(/\s/.test(text[p.endChar] ?? " "), "chunk must end before a space").toBe(true);
      expect(/\s/.test(text[p.startChar - 1] ?? " "), "chunk must start after a space").toBe(true);
    }
    expectNoTextLost(text, pieces);
  });

  it("cuts in the middle of a word only when there is no space anywhere", () => {
    const text = "x".repeat(500);
    const pieces = chunkParagraphs(text, NO_OVERLAP);
    expect(pieces.map((p) => p.text.length)).toEqual([200, 200, 100]);
    expectNoTextLost(text, pieces);
  });

  it("merges a tiny leftover into the previous chunk instead of leaving it alone", () => {
    // 3 sentences fill the chunk (173 characters), then a 28 character sentence follows: under 15% of the target.
    const text = `${paragraph(1, 3)} Ends with a short line here.`;
    expect(text.length).toBeGreaterThan(SMALL.targetChars);
    const pieces = chunkParagraphs(text, SMALL);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].text).toBe(text);
  });

  it("never makes a chunk larger than the hard maximum", () => {
    const text = [paragraph(1, 7), paragraph(20, 1), paragraph(30, 9)].join("\n\n");
    for (const p of chunkParagraphs(text, SMALL)) {
      expect(p.text.length).toBeLessThanOrEqual(Math.floor(SMALL.targetChars * HARD_MAX_SHARE));
    }
  });

  it("gives the same result every time", () => {
    const text = [paragraph(1, 9), paragraph(20, 5)].join("\n\n");
    expect(chunkParagraphs(text, SMALL)).toEqual(chunkParagraphs(text, SMALL));
  });

  it("does not split after the dots inside a section number like 1.1", () => {
    const text = "1.1 Building access. Staff badges open the main doors.";
    expect(chunkParagraphs(text, { targetChars: 40, overlapChars: 0 }).map((p) => p.text)).toEqual([
      "1.1 Building access.",
      "Staff badges open the main doors.",
    ]);
  });
});

describe("chunkFixed (the naive baseline)", () => {
  it("cuts by size, so it cuts words in half", () => {
    const text = "The quick brown fox jumps over the lazy dog. ".repeat(20);
    const pieces = chunkFixed(text, { targetChars: 197, overlapChars: 40 });
    const midWord = pieces.filter((p) => /\w/.test(text[p.endChar] ?? " ") && /\w/.test(text[p.endChar - 1]));
    expect(midWord.length).toBeGreaterThan(0);
    // The paragraph chunker, on the same text and size, never does that.
    for (const p of chunkParagraphs(text, { targetChars: 197, overlapChars: 40 })) {
      expect(/\w/.test(text[p.endChar] ?? " ") && /\w/.test(text[p.endChar - 1])).toBe(false);
    }
  });

  it("overlaps neighbours by the overlap size and never exceeds the target", () => {
    const text = "abcdefghij ".repeat(100);
    const pieces = chunkFixed(text, SMALL);
    for (const p of pieces) expect(p.text.length).toBeLessThanOrEqual(SMALL.targetChars);
    expect(pieces[0].endChar - pieces[1].startChar).toBeGreaterThanOrEqual(SMALL.overlapChars - 1);
    expectExactSlices(text, pieces);
    expectNoTextLost(text, pieces);
  });

  it("returns nothing for a blank page and one chunk for a short page", () => {
    expect(chunkFixed("   ", SMALL)).toEqual([]);
    expect(chunkFixed("Short page.", SMALL).map((p) => p.text)).toEqual(["Short page."]);
  });
});

// A seeded random generator, so a failure can be reproduced.
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPage(rand: () => number): string {
  const words = ["policy", "staff", "office", "the", "of", "and", "4.2", "e.g.", "Dr.", "ERR-4021", "x".repeat(30), "leave", "budget"];
  const paragraphs: string[] = [];
  for (let p = 0, n = 1 + Math.floor(rand() * 6); p < n; p++) {
    const sentences: string[] = [];
    for (let s = 0, m = 1 + Math.floor(rand() * 8); s < m; s++) {
      const len = 1 + Math.floor(rand() * (rand() < 0.1 ? 90 : 18)); // some very long sentences
      const w = Array.from({ length: len }, () => words[Math.floor(rand() * words.length)]);
      sentences.push(w.join(rand() < 0.1 ? "  " : " ") + (rand() < 0.9 ? "." : ""));
    }
    paragraphs.push(sentences.join(rand() < 0.2 ? "\n" : " "));
  }
  return paragraphs.join(rand() < 0.3 ? "\n \n" : "\n\n");
}

describe("properties on many random pages", () => {
  const settingsList: ChunkSettings[] = [
    { targetChars: 200, overlapChars: 40 },
    { targetChars: 200, overlapChars: 0 },
    { targetChars: 400, overlapChars: 100 },
    { targetChars: 2000, overlapChars: 240 },
  ];

  it("holds for both chunkers: exact slices, nothing lost, sizes within limits, chunks move forward", () => {
    const rand = mulberry32(20260920);
    for (let i = 0; i < 300; i++) {
      const text = randomPage(rand);
      for (const settings of settingsList) {
        const paragraphPieces = chunkParagraphs(text, settings);
        const fixedPieces = chunkFixed(text, settings);

        for (const [name, pieces, limit] of [
          ["paragraph", paragraphPieces, Math.floor(settings.targetChars * HARD_MAX_SHARE)],
          ["fixed", fixedPieces, settings.targetChars],
        ] as const) {
          const context = `${name}, page ${i}, target ${settings.targetChars}`;
          expectExactSlices(text, pieces);
          expectNoTextLost(text, pieces);
          for (const p of pieces) expect(p.text.length, context).toBeLessThanOrEqual(limit);
          for (let k = 1; k < pieces.length; k++) {
            expect(pieces[k].startChar, context).toBeGreaterThan(pieces[k - 1].startChar);
            expect(pieces[k].endChar, context).toBeGreaterThan(pieces[k - 1].endChar);
          }
        }
      }
    }
  });
});

describe("chunkPages", () => {
  const settings = SMALL;

  it("numbers chunks across the whole document and keeps every chunk on its own page", () => {
    const pages = [
      { pageNumber: 2, text: paragraph(20, 6) },
      { pageNumber: 1, text: paragraph(1, 6) },
      { pageNumber: 3, text: "" }, // a blank page has no chunks
      { pageNumber: 4, text: paragraph(40, 1) },
    ];
    const drafts = chunkPages(pages, "paragraph", settings);

    expect(drafts.map((d) => d.chunkIndex)).toEqual(drafts.map((_, i) => i));
    expect(drafts.map((d) => d.pageNumber)).toEqual([...drafts.map((d) => d.pageNumber)].sort((a, b) => a - b));
    expect(new Set(drafts.map((d) => d.pageNumber))).toEqual(new Set([1, 2, 4]));
    for (const d of drafts) {
      const page = pages.find((p) => p.pageNumber === d.pageNumber)!;
      expect(page.text.slice(d.startChar, d.endChar)).toBe(d.text);
      expect(d.strategy).toBe("paragraph");
    }
  });

  it("records a token estimate of characters / 4 and a hash that depends only on the text", () => {
    const [a, b] = chunkPages(
      [
        { pageNumber: 1, text: "Exactly the same words here." },
        { pageNumber: 2, text: "Exactly the same words here." },
      ],
      "paragraph",
      settings,
    );
    expect(a.tokenEstimate).toBe(Math.ceil("Exactly the same words here.".length / 4));
    expect(a.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.chunkIndex).not.toBe(b.chunkIndex);
  });

  it("runs the strategy that was asked for", () => {
    const pages = [{ pageNumber: 1, text: "x".repeat(700) }];
    expect(chunkPages(pages, "fixed", settings).every((d) => d.strategy === "fixed")).toBe(true);
    expect(chunkPages(pages, "fixed", settings)).not.toEqual(chunkPages(pages, "paragraph", settings).map((d) => ({ ...d, strategy: "fixed" })));
  });
});
