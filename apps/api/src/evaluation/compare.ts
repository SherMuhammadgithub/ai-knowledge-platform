import { readFileSync } from "node:fs";
import type { ChunkStrategy } from "../chunking";
import type { QuestionResult, RunMetrics } from "./metrics";

/**
 * Side-by-side view of stored evaluation runs (Milestone 6, Checkpoint D).
 *
 * Runs can only be compared when they answer the same questions with the same embedding setup, otherwise a
 * difference in the numbers could come from the questions or the model instead of from the chunking. Anything
 * else is refused, not shown with a warning.
 */

/** The parts of a stored run file that comparing needs. */
export type StoredRun = {
  runId: string;
  label: string | null;
  ranAt: string;
  strategy: ChunkStrategy;
  retrieval: string;
  embedding: { model: string; dimensions: number; setupId: string };
  questionSet: { name: string; sha256: string; ran: number };
  chunks: { count: number; avgTokens: number; minTokens: number; maxTokens: number; configuredTargetTokens: number; configuredOverlapTokens: number };
  /** Runs stored before tokens were measured have no avgRetrievedTokens. */
  metrics: Omit<RunMetrics, "avgRetrievedTokens"> & { avgRetrievedTokens?: number };
  results: QuestionResult[];
};

export class CompareError extends Error {}

export function loadRunFile(path: string): StoredRun {
  let json: any;
  try {
    const raw = readFileSync(path, "utf8");
    json = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw); // a file saved with a byte order mark still reads
  } catch (err) {
    throw new CompareError(`${path} is not a readable run file: ${err instanceof Error ? err.message : err}`);
  }
  if (!json?.runId || !json?.questionSet?.sha256 || !Array.isArray(json?.results) || !json?.metrics) {
    throw new CompareError(`${path} does not look like a stored evaluation run`);
  }
  return json as StoredRun;
}

export type SummaryRow = {
  name: string; // "paragraph", or "paragraph (label)" when two runs share a strategy
  strategy: ChunkStrategy;
  chunks: number;
  avgChunkTokens: number;
  hitRate1: number;
  hitRate3: number;
  hitRate5: number;
  mrr: number;
  /** Average estimated tokens in the 5 chunks retrieved for a question. Null for runs stored before this was measured. */
  avgRetrievedTokens: number | null;
  unreachable: number;
};

export type QuestionRow = {
  id: string;
  question: string;
  answerable: boolean;
  /** One entry per run, in the order the runs were given: rank of the first correct chunk, or null for a miss (or unanswerable). */
  ranks: (number | null)[];
  topScores: (number | null)[];
  /** Answerable question whose rank is not the same in every run. */
  changed: boolean;
};

export type Comparison = {
  questionSet: { name: string; sha256: string };
  setupId: string;
  summary: SummaryRow[];
  questions: QuestionRow[];
  /** Answerable questions where at least one run ranked the right chunk differently. */
  changedIds: string[];
};

export function compareRuns(runs: StoredRun[]): Comparison {
  if (runs.length < 2) throw new CompareError("Give at least two runs to compare.");
  const [first] = runs;
  for (const run of runs) {
    if (run.questionSet.sha256 !== first.questionSet.sha256) {
      throw new CompareError(
        `These runs used different question files (${first.questionSet.sha256.slice(0, 8)} and ${run.questionSet.sha256.slice(0, 8)}). Numbers from different questions cannot be compared.`,
      );
    }
    if (run.embedding.setupId !== first.embedding.setupId) {
      throw new CompareError(`These runs used different embedding setups (${first.embedding.setupId} and ${run.embedding.setupId}).`);
    }
    const ids = run.results.map((r) => r.id).join(",");
    if (ids !== first.results.map((r) => r.id).join(",")) throw new CompareError("These runs did not run the same questions in the same order.");
  }

  const names = runs.map((r) => (runs.filter((o) => o.strategy === r.strategy).length > 1 ? `${r.strategy} (${r.label ?? r.runId.slice(0, 6)})` : r.strategy));
  const summary = runs.map((r, i): SummaryRow => ({
    name: names[i],
    strategy: r.strategy,
    chunks: r.chunks.count,
    avgChunkTokens: r.chunks.avgTokens,
    hitRate1: r.metrics.hitRate[1],
    hitRate3: r.metrics.hitRate[3],
    hitRate5: r.metrics.hitRate[5],
    mrr: r.metrics.mrr,
    avgRetrievedTokens: r.metrics.avgRetrievedTokens ?? null,
    unreachable: r.metrics.unreachable,
  }));

  const questions = first.results.map((q, index): QuestionRow => {
    const ranks = runs.map((r) => r.results[index].rank);
    return {
      id: q.id,
      question: q.question,
      answerable: q.answerable,
      ranks,
      topScores: runs.map((r) => r.results[index].topScore),
      changed: q.answerable && new Set(ranks).size > 1,
    };
  });

  return {
    questionSet: { name: first.questionSet.name, sha256: first.questionSet.sha256 },
    setupId: first.embedding.setupId,
    summary,
    questions,
    changedIds: questions.filter((q) => q.changed).map((q) => q.id),
  };
}
