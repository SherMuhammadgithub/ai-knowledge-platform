import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { firstHitRank, rangeOf, summarize, type QuestionResult } from "../src/evaluation/metrics";
import { containsQuote, isHit, loadQuestionFile, normalizeText } from "../src/evaluation/questions";

const dir = mkdtempSync(join(tmpdir(), "akp-eval-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const question = (over: Record<string, unknown> = {}) => ({
  id: "q1",
  status: "keep",
  question: "How much notice do I need to give?",
  answerable: true,
  answers: [{ document: "guide.txt", quote: "at least 28 days’ notice" }],
  kind: "plain",
  ...over,
});
const writeFile = (name: string, body: unknown, raw = false) => {
  const path = join(dir, name);
  writeFileSync(path, raw ? (body as string) : JSON.stringify(body));
  return path;
};
const file = (questions: unknown[]) => ({ name: "set", questions });

describe("matching quotes", () => {
  it("ignores curly quotes, dashes, case, invisible characters and line breaks", () => {
    expect(normalizeText("You\u2019ll  get\n\u201CONE\u201D\u00A0week \u2013 or more\u200B")).toBe(`you'll get "one" week - or more`);
    expect(containsQuote("If they’re on\nfamily leave, they can carry over untaken leave.", "they're on family leave")).toBe(true);
    expect(containsQuote("at least 28 days’ notice", "AT LEAST 28 DAYS' NOTICE")).toBe(true);
  });

  it("does not match different text or a quote longer than the text", () => {
    expect(containsQuote("at least 28 days notice", "at least 29 days notice")).toBe(false);
    expect(containsQuote("28 days", "28  days notice")).toBe(false);
  });

  it("counts a chunk as a hit only when the document AND the quote both match", () => {
    const q = question({ answers: [{ document: "a.txt", quote: "twelve weeks of notice" }, { document: "b.txt", quote: "eight weeks of notice" }] });
    expect(isHit(q as never, { documentName: "a.txt", text: "You get twelve weeks of notice." })).toBe(true);
    expect(isHit(q as never, { documentName: "b.txt", text: "You get eight weeks of notice." })).toBe(true);
    // the right quote in the wrong document is not an answer to this question
    expect(isHit(q as never, { documentName: "b.txt", text: "You get twelve weeks of notice." })).toBe(false);
    // the right document without the quote is not either
    expect(isHit(q as never, { documentName: "a.txt", text: "You get some weeks of notice." })).toBe(false);
  });

  it("finds nothing for a question that has no answers", () => {
    expect(isHit({ answers: [] }, { documentName: "a.txt", text: "anything at all" })).toBe(false);
  });
});

describe("the question file", () => {
  it("loads a valid file and fingerprints its exact content", () => {
    const a = loadQuestionFile(writeFile("a.json", file([question()])));
    const b = loadQuestionFile(writeFile("b.json", file([question({ question: "How much notice must I give?" })])));
    expect(a.questions).toHaveLength(1);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.sha256).not.toBe(b.sha256);
  });

  it("accepts a file saved with a byte order mark (PowerShell adds one)", () => {
    const path = writeFile("bom.json", "\uFEFF" + JSON.stringify(file([question()])), true);
    expect(loadQuestionFile(path).questions).toHaveLength(1);
  });

  it("accepts an unanswerable question with no answers", () => {
    const q = question({ id: "u1", answerable: false, answers: [], kind: "not in the documents" });
    expect(loadQuestionFile(writeFile("u.json", file([q]))).questions[0].answerable).toBe(false);
  });

  it.each([
    ["answerable but no answer", question({ answers: [] }), /answerable question needs at least one answer/],
    ["unanswerable but has an answer", question({ answerable: false }), /unanswerable one must have none/],
    ["a quote that is too short to mean anything", question({ answers: [{ document: "a.txt", quote: "notice" }] }), /at least 12 characters/],
    ["an unknown status", question({ status: "maybe" }), /status/],
    ["no document name", question({ answers: [{ document: "", quote: "long enough quote here" }] }), /document/],
  ])("rejects %s", (_name, bad, message) => {
    expect(() => loadQuestionFile(writeFile("bad.json", file([bad])))).toThrow(message);
  });

  it("rejects the same id twice, an empty list, and text that is not JSON", () => {
    expect(() => loadQuestionFile(writeFile("dup.json", file([question(), question()])))).toThrow(/used twice: q1/);
    expect(() => loadQuestionFile(writeFile("empty.json", file([])))).toThrow(/questions/);
    expect(() => loadQuestionFile(writeFile("nojson.json", "{ not json", true))).toThrow(/not valid JSON/);
  });
});

const result = (id: string, rank: number | null, over: Partial<QuestionResult> = {}): QuestionResult => ({
  id, question: id, kind: "plain", answerable: true, rank, topScore: 0.7, reachable: true, retrieved: [], ...over,
});
const chunk = (tokens: number) => ({ rank: 1, score: 0.7, chunkId: "c", documentName: "d.txt", chunkIndex: 0, hit: false, tokens, preview: "" });

describe("scores", () => {
  it("finds the rank of the first correct chunk", () => {
    expect(firstHitRank([{ hit: false }, { hit: true }, { hit: true }])).toBe(2);
    expect(firstHitRank([{ hit: false }])).toBeNull();
    expect(firstHitRank([])).toBeNull();
  });

  it("computes hit rate at 1, 3 and 5 and MRR over the answerable questions", () => {
    // ranks: 1, 2, 3, 5, miss -> hit@1 1/5, hit@3 3/5, hit@5 4/5, MRR (1 + 1/2 + 1/3 + 1/5 + 0) / 5
    const m = summarize([result("a", 1), result("b", 2), result("c", 3), result("d", 5), result("e", null)]);
    expect(m.answerable).toBe(5);
    expect(m.hitRate[1]).toBeCloseTo(0.2);
    expect(m.hitRate[3]).toBeCloseTo(0.6);
    expect(m.hitRate[5]).toBeCloseTo(0.8);
    expect(m.mrr).toBeCloseTo((1 + 1 / 2 + 1 / 3 + 1 / 5) / 5);
  });

  it("leaves unanswerable questions out of the scores but keeps their top scores", () => {
    const m = summarize([
      result("a", 1, { topScore: 0.8 }),
      result("u1", null, { answerable: false, topScore: 0.61 }),
      result("u2", null, { answerable: false, topScore: 0.65 }),
    ]);
    expect(m.answerable).toBe(1);
    expect(m.unanswerable).toBe(2);
    expect(m.hitRate[1]).toBe(1); // an unanswerable question is not a miss
    expect(m.topScoreWhenAnswerable).toEqual({ min: 0.8, median: 0.8, max: 0.8 });
    expect(m.topScoreWhenUnanswerable?.min).toBeCloseTo(0.61);
    expect(m.topScoreWhenUnanswerable?.max).toBeCloseTo(0.65);
  });

  it("counts questions the chunking cut through, and still scores them as misses", () => {
    const m = summarize([result("a", 1), result("b", null, { reachable: false })]);
    expect(m.unreachable).toBe(1);
    expect(m.hitRate[5]).toBe(0.5);
  });

  it("gives zeros, not NaN, when nothing is answerable", () => {
    const m = summarize([result("u", null, { answerable: false })]);
    expect(m.hitRate).toEqual({ 1: 0, 3: 0, 5: 0 });
    expect(m.mrr).toBe(0);
    expect(summarize([]).topScoreWhenAnswerable).toBeNull();
  });

  it("averages the tokens retrieved per question, over every question run", () => {
    const m = summarize([
      result("a", 1, { retrieved: [chunk(400), chunk(500)] }), // 900
      result("b", null, { retrieved: [chunk(300)] }), // 300
      result("u", null, { answerable: false, retrieved: [chunk(600), chunk(600), chunk(600)] }), // 1800: unanswerable questions count too
    ]);
    expect(m.avgRetrievedTokens).toBeCloseTo(1000);
    expect(summarize([]).avgRetrievedTokens).toBe(0);
  });

  it("finds the median of odd and even lists", () => {
    expect(rangeOf([0.9, 0.1, 0.5])).toEqual({ min: 0.1, median: 0.5, max: 0.9 });
    expect(rangeOf([0.2, 0.4, 0.6, 0.8])?.median).toBeCloseTo(0.5);
    expect(rangeOf([])).toBeNull();
  });
});

// The question file that ships with the project: its quotes must really be in the GOV.UK files they name.
// Checked against the corpus files, so it needs no database and no provider call.
describe("the GOV.UK question file", () => {
  const root = resolve(__dirname, "../../../eval");
  const path = join(root, "questions", "govuk.json");
  const corpus = resolve(root, "corpus/govuk");
  const texts = new Map(readdirSync(corpus).filter((f) => f.endsWith(".txt")).map((f) => [f, readFileSync(join(corpus, f), "utf8")]));

  it("is valid", () => {
    const set = loadQuestionFile(path);
    expect(set.questions.length).toBeGreaterThanOrEqual(20);
  });

  it("names only documents that exist, and every quote is in the document it names", () => {
    const set = loadQuestionFile(path);
    const problems = set.questions.flatMap((q) =>
      q.answers.flatMap((a) => {
        const text = texts.get(a.document);
        if (!text) return [`${q.id}: no corpus file ${a.document}`];
        return containsQuote(text, a.quote) ? [] : [`${q.id}: "${a.quote}" is not in ${a.document}`];
      }),
    );
    expect(problems).toEqual([]);
  });

  it("has both answerable and unanswerable questions, and no two questions with the same wording", () => {
    const set = loadQuestionFile(path);
    expect(set.questions.some((q) => q.answerable)).toBe(true);
    expect(set.questions.some((q) => !q.answerable)).toBe(true);
    const wording = set.questions.map((q) => normalizeText(q.question));
    expect(new Set(wording).size).toBe(wording.length);
  });
});
