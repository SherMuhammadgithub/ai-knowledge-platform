import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { chunkPages } from "../src/chunking";
import { chunkByHeadings, detectHeadings, looksLikeHeading } from "../src/chunking/headings";
import { chunkParagraphs, HARD_MAX_SHARE } from "../src/chunking/paragraph";
import type { ChunkPiece, ChunkSettings } from "../src/chunking/settings";

const T: ChunkSettings = { targetChars: 150, overlapChars: 30 };
const BULLET = String.fromCharCode(0x2022);

// A sentence of a known size (57 characters), so tests can reason about which sections fit together.
const sentence = (n: number) => `Sentence number ${String(n).padStart(3, "0")} says one clear thing about the topic.`;
const body = (from: number, count: number) => Array.from({ length: count }, (_, i) => sentence(from + i)).join(" ");
const section = (name: string, sentences = 1, from = 1) => `${name}\n\n${body(from, sentences)}`;
const doc = (...sections: string[]) => sections.join("\n\n");

function expectExactSlices(text: string, pieces: ChunkPiece[]) {
  const bad = pieces.filter((p) => text.slice(p.startChar, p.endChar) !== p.text || p.text.length === 0 || p.text !== p.text.trim());
  expect(bad, "chunks whose text is not exactly the page slice, or empty, or padded with whitespace").toEqual([]);
}
function expectNoTextLost(text: string, pieces: ChunkPiece[]) {
  const covered = new Uint8Array(text.length);
  for (const p of pieces) covered.fill(1, p.startChar, p.endChar);
  const missing: number[] = [];
  for (let i = 0; i < text.length; i++) if (!covered[i] && !/\s/.test(text[i])) missing.push(i);
  expect(missing, "positions of characters that are in no chunk").toEqual([]);
}

describe("what looks like a heading", () => {
  it.each([
    "Annual leave",
    "Holiday entitlement",
    "4.2 Annual leave",
    "1. Overview",
    "How to claim?",
    "Statutory Sick Pay (SSP)",
    "Rolled-up holiday pay",
    "Start and end dates - Paternity Leave",
    "What you'll get",
  ])("accepts %j", (line) => {
    expect(looksLikeHeading(line)).toBe(true);
  });

  it.each([
    ["an empty line", ""],
    ["a single character", "A"],
    ["a line that starts in lower case", "a short line in lower case"],
    ["a sentence", "This is a whole sentence about leave."],
    ["a line that introduces a list", "You will get:"],
    ["a dash bullet", "- half a week's pay"],
    ["a dot bullet", `${BULLET} half a week's pay`],
    ["a numbered list item", "1) tell your employer"],
    ["a numbered item that starts in lower case", "2. tell your employer"],
    ["a label and a value", "Telephone: 0300 123 11 00"],
    ["a web address", "Source: https://www.gov.uk/holiday"],
    ["an e-mail address", "Rapid Response Service rrs.enquiries@dwp.gov.uk"],
    ["a table row", "Working pattern | How a week's pay is calculated"],
    ["a line of several lines", "Acas helpline\nTelephone: 0300 123 11 00"],
    ["a line longer than 80 characters", "A".padEnd(81, "a")],
    ["a line of more than 12 words", "One two three four five six seven eight nine ten eleven twelve thirteen"],
  ])("rejects %s", (_name, line) => {
    expect(looksLikeHeading(line)).toBe(false);
  });

  it("finds headings by position, and only single-line blocks", () => {
    const text = doc("Alpha", "Some text of the alpha section.", "Beta", "- a bullet\n- another bullet", "Gamma");
    const found = detectHeadings(text);
    expect(found.map((h) => h.text)).toEqual(["Alpha", "Beta", "Gamma"]);
    for (const h of found) expect(text.slice(h.start, h.end)).toBe(h.text);
  });
});

describe("chunkByHeadings", () => {
  it("returns nothing for an empty page", () => {
    expect(chunkByHeadings("", T)).toEqual([]);
    expect(chunkByHeadings("\n\n  \n", T)).toEqual([]);
  });

  it("packs whole sections into a chunk until the next one would pass the target, and cuts only at headings", () => {
    const sections = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"].map((name, i) => section(name, 1, i + 1));
    const text = doc(...sections);
    const pieces = chunkByHeadings(text, T);

    // each section is about 65 characters: two fit in 150, three do not
    expect(pieces.map((p) => p.text)).toEqual([sections[0] + "\n\n" + sections[1], sections[2] + "\n\n" + sections[3], sections[4] + "\n\n" + sections[5]]);
    expect(pieces.map((p) => p.heading)).toEqual(["Alpha", "Gamma", "Epsilon"]);
    expectExactSlices(text, pieces);
    expectNoTextLost(text, pieces);
  });

  it("does not cut a section that fits, even if a chunk of the paragraph chunker would have", () => {
    // Three sections of about 100 characters (heading + one sentence + a short sentence).
    const s = (name: string, n: number) => `${name}\n\n${sentence(n)} Short one.`;
    const sections = [s("First topic", 1), s("Second topic", 2), s("Third topic", 3)];
    const pieces = chunkByHeadings(doc(...sections), T);
    expect(pieces.map((p) => p.text)).toEqual(sections); // one section per chunk, each whole
    expect(pieces.map((p) => p.heading)).toEqual(["First topic", "Second topic", "Third topic"]);
  });

  it("splits a section that is longer than the target, and every piece keeps that section's heading", () => {
    const long = section("Long section", 8); // about 480 characters
    const text = doc(section("Short one", 1, 20), long, section("Short two", 1, 30));
    const pieces = chunkByHeadings(text, T);

    const inLong = pieces.filter((p) => p.heading === "Long section");
    expect(inLong.length).toBeGreaterThan(2);
    expect(inLong[0].text.startsWith("Long section")).toBe(true); // only the first piece holds the heading text
    expect(inLong[1].text.startsWith("Long section")).toBe(false);
    expect(pieces[0].heading).toBe("Short one");
    expect(pieces.at(-1)!.heading).toBe("Short two");
    expectExactSlices(text, pieces);
    expectNoTextLost(text, pieces);
  });

  it("treats a title followed at once by a sub-heading as one section named by the sub-heading", () => {
    const text = doc("Big title", "Overview", body(1, 1), "Next part", body(2, 1));
    const pieces = chunkByHeadings(text, T);
    expect(pieces).toHaveLength(1); // both sections fit in 150
    expect(pieces[0].heading).toBe("Overview");
    expect(pieces[0].text.startsWith("Big title")).toBe(true);
  });

  it("gives text before the first heading no heading", () => {
    const text = doc(body(1, 1), section("First heading", 1, 2));
    const pieces = chunkByHeadings(text, { targetChars: 100, overlapChars: 0 });
    expect(pieces[0].heading).toBeNull();
    expect(pieces.at(-1)!.heading).toBe("First heading");
  });

  it("cuts a page with no headings exactly like the paragraph chunker", () => {
    const text = [body(1, 4), body(5, 4), body(9, 4)].join("\n\n");
    expect(detectHeadings(text)).toEqual([]);
    // an overlap of more than one sentence (57 characters), so the paragraph chunker really has overlap to apply
    const withOverlap = { targetChars: 150, overlapChars: 70 };
    expect(chunkParagraphs(text, withOverlap).some((p, i, all) => i > 0 && p.startChar < all[i - 1].endChar)).toBe(true);
    expect(chunkByHeadings(text, withOverlap)).toEqual(chunkParagraphs(text, withOverlap));
  });

  it("joins a tiny leftover at the end to the previous chunk", () => {
    const text = doc(section("Alpha", 1), section("Beta", 1, 2), section("Gamma", 1, 3), "Note");
    const pieces = chunkByHeadings(text, { targetChars: 200, overlapChars: 0 });
    expect(pieces.at(-1)!.text.endsWith("Note")).toBe(true);
    expect(pieces.at(-1)!.heading).toBe("Alpha"); // the merged chunk keeps the heading of the chunk it joined
    expect(pieces.every((p) => p.text.length > "Note".length)).toBe(true);
  });

  it("keeps every chunk within the hard maximum, in order, with exact text, losing nothing (random pages)", () => {
    let seed = 20260921;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));

    const problems: string[] = [];
    for (let round = 0; round < 60; round++) {
      const parts: string[] = [];
      let n = 1;
      if (random() < 0.3) parts.push(body(n++, pick(1, 4))); // some text before the first heading
      for (let s = pick(1, 12); s > 0; s--) {
        if (random() < 0.85) parts.push(`Heading ${round}-${s} ${["alpha", "beta", "gamma"][pick(0, 2)]}`);
        for (let p = pick(1, 4); p > 0; p--) {
          parts.push(body(n, pick(1, 6)));
          n += 6;
        }
      }
      const text = parts.join("\n\n");
      const settings = { targetChars: pick(120, 600), overlapChars: 0 };
      settings.overlapChars = pick(0, Math.floor(settings.targetChars / 2));
      const pieces = chunkByHeadings(text, settings);

      const hardMax = Math.floor(settings.targetChars * HARD_MAX_SHARE);
      pieces.forEach((p, i) => {
        if (text.slice(p.startChar, p.endChar) !== p.text) problems.push(`round ${round}: chunk ${i} is not the page slice`);
        if (p.text.length > hardMax) problems.push(`round ${round}: chunk ${i} has ${p.text.length} characters, over ${hardMax}`);
        if (i > 0 && p.startChar <= pieces[i - 1].startChar) problems.push(`round ${round}: chunk ${i} does not start after chunk ${i - 1}`);
      });
      const covered = new Uint8Array(text.length);
      for (const p of pieces) covered.fill(1, p.startChar, p.endChar);
      for (let i = 0; i < text.length; i++) if (!covered[i] && !/\s/.test(text[i])) { problems.push(`round ${round}: character ${i} is in no chunk`); break; }
    }
    expect(problems).toEqual([]);
  });
});

describe("through chunkPages", () => {
  it("sets the heading only for the heading strategy", () => {
    const pages = [{ pageNumber: 1, text: doc(section("Alpha", 1), section("Beta", 1, 2)) }];
    const heading = chunkPages(pages, "heading", T);
    expect(heading.map((c) => c.heading)).toEqual(["Alpha"]);
    expect(heading[0].strategy).toBe("heading");
    for (const strategy of ["paragraph", "fixed"] as const) {
      expect(chunkPages(pages, strategy, T).every((c) => c.heading === null)).toBe(true);
    }
  });

  it("never lets a chunk cross a page", () => {
    const pages = [
      { pageNumber: 1, text: section("First page heading", 1) },
      { pageNumber: 2, text: section("Second page heading", 1, 2) },
    ];
    const drafts = chunkPages(pages, "heading", { targetChars: 1000, overlapChars: 0 });
    expect(drafts.map((d) => [d.pageNumber, d.heading])).toEqual([[1, "First page heading"], [2, "Second page heading"]]);
  });
});

// The seven GOV.UK guides are real pages, so they are the real test of the guess.
describe("the GOV.UK guides", () => {
  const corpus = resolve(__dirname, "../../../eval/corpus/govuk");
  const guides = readdirSync(corpus).filter((f) => f.endsWith(".txt")).map((f) => [f, readFileSync(join(corpus, f), "utf8")] as const);
  const settings: ChunkSettings = { targetChars: 2000, overlapChars: 240 };

  it("finds their headings, and nothing that is a sentence, a link or a label", () => {
    const flexible = guides.find(([f]) => f.includes("flexible-working"))![1];
    const found = detectHeadings(flexible).map((h) => h.text);
    for (const expected of ["Overview", "Types of flexible working", "Job sharing", "Applying for flexible working", "Reasons for refusing", "Going to an employment tribunal"]) {
      expect(found).toContain(expected);
    }
    for (const [name, text] of guides) {
      for (const h of detectHeadings(text)) {
        expect(h.text, `${name}: "${h.text}" looks like a sentence, link or label`).not.toMatch(/[.:;,]$|:\/\/|:\s/);
      }
      expect(detectHeadings(text).length, `${name} should have several headings`).toBeGreaterThan(8);
    }
  });

  it("cuts every guide with exact slices, without losing text, with every chunk under the hard maximum", () => {
    for (const [name, text] of guides) {
      const pieces = chunkByHeadings(text, settings);
      expect(pieces.length, name).toBeGreaterThan(1);
      expectExactSlices(text, pieces);
      expectNoTextLost(text, pieces);
      for (const p of pieces) expect(p.text.length, name).toBeLessThanOrEqual(Math.floor(settings.targetChars * HARD_MAX_SHARE));
    }
  });

  it("starts each guide's first chunk with the title and names it after the first sub-heading", () => {
    const [, text] = guides.find(([f]) => f.includes("flexible-working"))!;
    const first = chunkByHeadings(text, settings)[0];
    expect(first.text.startsWith("Flexible working")).toBe(true);
    expect(first.heading).toBe("Overview");
  });
});
