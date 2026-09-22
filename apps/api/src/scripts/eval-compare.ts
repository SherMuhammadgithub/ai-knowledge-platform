// Puts stored evaluation runs side by side. Reads only files in eval/runs/. No database, no Gemini.
//
// Run: bun run --cwd apps/api eval:compare <run file> <run file> [<run file> ...]
//      A file name alone is looked up in eval/runs/, so the file names printed by eval:run work as they are.
//
// The runs must have used the same question file and the same embedding setup, or it refuses.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { CompareError, compareRuns, loadRunFile } from "../evaluation/compare";

const RUNS_DIR = resolve(process.cwd(), "../../eval/runs");
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 3)}...` : text);

function main() {
  const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (files.length < 2) throw new CompareError("Give at least two run files, for example: eval:compare a.json b.json c.json");
  const runs = files.map((f) => loadRunFile(existsSync(resolve(process.cwd(), f)) ? resolve(process.cwd(), f) : join(RUNS_DIR, f)));
  const result = compareRuns(runs);

  console.log(`Question set "${result.questionSet.name}" (${result.questionSet.sha256.slice(0, 8)}), embedding setup ${result.setupId}\n`);

  const w = Math.max(...result.summary.map((s) => s.name.length), 10);
  console.log(`${"".padEnd(w)}  chunks  avg tok  hit@1   hit@3   hit@5   MRR    tokens retrieved (top 5)  cut through`);
  for (const s of result.summary) {
    console.log(
      `${s.name.padEnd(w)}  ${String(s.chunks).padStart(6)}  ${String(s.avgChunkTokens).padStart(7)}  ${pct(s.hitRate1).padStart(6)}  ${pct(s.hitRate3).padStart(6)}  ${pct(s.hitRate5).padStart(6)}  ${s.mrr.toFixed(3)}  ${(s.avgRetrievedTokens === null ? "n/a" : String(Math.round(s.avgRetrievedTokens))).padStart(23)}  ${String(s.unreachable).padStart(11)}`,
    );
  }

  const cell = (rank: number | null, answerable: boolean) => (!answerable ? "-" : rank === null ? "miss" : `@${rank}`);
  console.log(`\nRank of the first correct chunk (top score in brackets). "changed" marks answerable questions where the runs differ.\n`);
  console.log(`${"id".padEnd(5)}${result.summary.map((s) => s.name.slice(0, 16).padEnd(17)).join("")}question`);
  for (const q of result.questions) {
    const cells = q.ranks.map((r, i) => `${cell(r, q.answerable)} (${q.topScores[i]?.toFixed(3) ?? "-"})`.padEnd(17)).join("");
    console.log(`${q.id.padEnd(5)}${cells}${q.changed ? "changed  " : ""}${clip(q.question, q.changed ? 50 : 58)}`);
  }
  console.log(`\n${result.changedIds.length} of ${result.questions.filter((q) => q.answerable).length} answerable questions changed rank between runs${result.changedIds.length ? `: ${result.changedIds.join(", ")}` : ""}.`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof CompareError || err instanceof Error ? err.message : err);
  process.exit(1);
}
