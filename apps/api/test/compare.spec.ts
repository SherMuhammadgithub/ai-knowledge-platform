import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CompareError, compareRuns, loadRunFile, type StoredRun } from "../src/evaluation/compare";
import { summarize, type QuestionResult } from "../src/evaluation/metrics";

const dir = mkdtempSync(join(tmpdir(), "akp-compare-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const result = (id: string, rank: number | null, over: Partial<QuestionResult> = {}): QuestionResult => ({
  id, question: `question ${id}`, kind: "plain", answerable: true, rank, topScore: 0.7, reachable: true, retrieved: [], ...over,
});

function run(strategy: StoredRun["strategy"], results: QuestionResult[], over: Partial<StoredRun> = {}): StoredRun {
  return {
    runId: `${strategy}-run-id`,
    label: null,
    ranAt: "2026-09-21T10:00:00.000Z",
    strategy,
    retrieval: "qdrant",
    embedding: { model: "m", dimensions: 768, setupId: "m|768|w" },
    questionSet: { name: "set", sha256: "a".repeat(64), ran: results.length },
    chunks: { count: 36, avgTokens: 449, minTokens: 155, maxTokens: 507, configuredTargetTokens: 500, configuredOverlapTokens: 60 },
    metrics: summarize(results),
    results,
    ...over,
  };
}

describe("comparing runs", () => {
  it("lines the runs up per question and lists the questions whose rank differs", () => {
    const a = run("paragraph", [result("q1", 1), result("q2", 2), result("q3", null), result("u1", null, { answerable: false, topScore: 0.62 })]);
    const b = run("heading", [result("q1", 1), result("q2", 1), result("q3", null), result("u1", null, { answerable: false, topScore: 0.66 })]);
    const c = compareRuns([a, b]);

    expect(c.summary.map((s) => s.name)).toEqual(["paragraph", "heading"]);
    expect(c.summary[0].hitRate1).toBeCloseTo(1 / 3);
    expect(c.summary[1].hitRate1).toBeCloseTo(2 / 3);
    expect(c.questions.map((q) => [q.id, q.ranks, q.changed])).toEqual([
      ["q1", [1, 1], false],
      ["q2", [2, 1], true],
      ["q3", [null, null], false], // a miss in both runs is not a change
      ["u1", [null, null], false], // an unanswerable question never counts as a change, even if its score moved
    ]);
    expect(c.questions[3].topScores).toEqual([0.62, 0.66]);
    expect(c.changedIds).toEqual(["q2"]);
  });

  it("treats a miss that becomes a hit as a change", () => {
    const c = compareRuns([run("paragraph", [result("q1", null)]), run("fixed", [result("q1", 4)])]);
    expect(c.changedIds).toEqual(["q1"]);
  });

  it("names two runs of the same strategy by their label so they can be told apart", () => {
    const a = run("paragraph", [result("q1", 1)], { label: "baseline" });
    const b = run("paragraph", [result("q1", 1)], { label: "again", runId: "other-id" });
    expect(compareRuns([a, b]).summary.map((s) => s.name)).toEqual(["paragraph (baseline)", "paragraph (again)"]);
  });

  it("refuses runs made from different question files", () => {
    const a = run("paragraph", [result("q1", 1)]);
    const b = run("heading", [result("q1", 1)], { questionSet: { name: "set", sha256: "b".repeat(64), ran: 1 } });
    expect(() => compareRuns([a, b])).toThrow(/different question files/);
  });

  it("refuses runs made with different embedding setups", () => {
    const a = run("paragraph", [result("q1", 1)]);
    const b = run("heading", [result("q1", 1)], { embedding: { model: "m2", dimensions: 768, setupId: "m2|768|w" } });
    expect(() => compareRuns([a, b])).toThrow(/different embedding setups/);
  });

  it("refuses runs that did not run the same questions", () => {
    const a = run("paragraph", [result("q1", 1), result("q2", 1)]);
    const b = run("heading", [result("q1", 1), result("q3", 1)]);
    expect(() => compareRuns([a, b])).toThrow(/same questions/);
  });

  it("needs at least two runs", () => {
    expect(() => compareRuns([run("paragraph", [result("q1", 1)])])).toThrow(CompareError);
  });

  it("shows retrieved tokens when the run has them and null when an older run does not", () => {
    const withTokens = run("heading", [result("q1", 1)]);
    withTokens.metrics = { ...withTokens.metrics, avgRetrievedTokens: 1834.4 };
    const older = run("paragraph", [result("q1", 1)]);
    delete (older.metrics as { avgRetrievedTokens?: number }).avgRetrievedTokens; // stored before tokens were measured
    const c = compareRuns([older, withTokens]);
    expect(c.summary.map((s) => s.avgRetrievedTokens)).toEqual([null, 1834.4]);
  });
});

describe("reading a run file", () => {
  it("reads a stored run", () => {
    const path = join(dir, "run.json");
    writeFileSync(path, JSON.stringify(run("paragraph", [result("q1", 1)])));
    expect(loadRunFile(path).strategy).toBe("paragraph");
  });

  it("refuses a file that is not a run, and text that is not JSON", () => {
    const other = join(dir, "other.json");
    writeFileSync(other, JSON.stringify({ hello: "world" }));
    expect(() => loadRunFile(other)).toThrow(/does not look like a stored evaluation run/);
    const broken = join(dir, "broken.json");
    writeFileSync(broken, "{ nope");
    expect(() => loadRunFile(broken)).toThrow(/not a readable run file/);
  });
});
