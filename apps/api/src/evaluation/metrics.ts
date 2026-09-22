/** How many chunks are retrieved per question in an evaluation run. The scores below are read at 1, 3 and this many. */
export const EVAL_K = 5;
export const CUTOFFS = [1, 3, 5] as const;

export type RetrievedChunk = {
  rank: number; // 1 is the closest
  score: number;
  chunkId: string;
  documentName: string;
  chunkIndex: number;
  hit: boolean;
  /** Estimated tokens in this chunk (characters / 4). */
  tokens: number;
  preview: string; // the first characters of the chunk, so a stored run can be read without the database
};

export type QuestionResult = {
  id: string;
  question: string;
  kind: string;
  answerable: boolean;
  /** Rank of the first correct chunk within the retrieved ones, or null if there was none. Always null when unanswerable. */
  rank: number | null;
  /** The score of the closest chunk, whatever it was. */
  topScore: number | null;
  /**
   * Can any single chunk contain the expected quote at all? False means chunking cut through the answer (or the
   * question file is wrong, which the runner refuses before it gets here).
   */
  reachable: boolean;
  retrieved: RetrievedChunk[];
};

export type Range = { min: number; median: number; max: number } | null;

export type RunMetrics = {
  answerable: number;
  unanswerable: number;
  /** Fraction of answerable questions with a correct chunk in the top k. */
  hitRate: Record<(typeof CUTOFFS)[number], number>;
  /** Mean of 1 / rank of the first correct chunk (0 when none in the top k), over answerable questions. */
  mrr: number;
  /** Answerable questions where no single chunk contains the expected quote. They count as misses. */
  unreachable: number;
  /** How strongly the closest chunk matched: for questions the documents can answer, and for those they cannot. */
  topScoreWhenAnswerable: Range;
  topScoreWhenUnanswerable: Range;
  /**
   * Average estimated tokens in the chunks retrieved for one question, over every question run. Strategies with
   * bigger chunks put more text into the same top 5, which helps a hit and costs more in the answer prompt.
   */
  avgRetrievedTokens: number;
};

export function firstHitRank(hits: { hit: boolean }[]): number | null {
  const index = hits.findIndex((h) => h.hit);
  return index === -1 ? null : index + 1;
}

export function rangeOf(values: number[]): Range {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { min: sorted[0], median, max: sorted[sorted.length - 1] };
}

export function summarize(results: QuestionResult[]): RunMetrics {
  const answerable = results.filter((r) => r.answerable);
  const unanswerable = results.filter((r) => !r.answerable);
  const share = (count: number) => (answerable.length ? count / answerable.length : 0);
  const hitAt = (k: number) => answerable.filter((r) => r.rank !== null && r.rank <= k).length;
  return {
    answerable: answerable.length,
    unanswerable: unanswerable.length,
    hitRate: { 1: share(hitAt(1)), 3: share(hitAt(3)), 5: share(hitAt(5)) },
    mrr: answerable.length ? answerable.reduce((sum, r) => sum + (r.rank ? 1 / r.rank : 0), 0) / answerable.length : 0,
    unreachable: answerable.filter((r) => !r.reachable).length,
    topScoreWhenAnswerable: rangeOf(answerable.flatMap((r) => (r.topScore === null ? [] : [r.topScore]))),
    topScoreWhenUnanswerable: rangeOf(unanswerable.flatMap((r) => (r.topScore === null ? [] : [r.topScore]))),
    avgRetrievedTokens: results.length ? results.reduce((sum, r) => sum + r.retrieved.reduce((t, c) => t + c.tokens, 0), 0) / results.length : 0,
  };
}
