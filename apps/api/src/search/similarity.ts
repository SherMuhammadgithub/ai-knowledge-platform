// The plain search of Milestone 5: compare a question's vector with every stored chunk vector, keep the closest.
// No index, no approximation: for a few thousand chunks this is fast enough, and it makes the idea visible.
// Milestone 6 replaces the loop with Qdrant, which does the same thing quickly for millions of vectors.

/** Cosine similarity: dot product divided by the two lengths. 1 means the same direction, 0 unrelated. */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) throw new Error(`Cannot compare vectors of length ${a.length} and ${b.length}`);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0; // an all-zero vector points nowhere
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export type Scored<T> = T & { score: number };

/** The `k` candidates closest to the query, best first. Ties keep the input order. */
export function rankBySimilarity<T extends { vector: ArrayLike<number> }>(
  query: ArrayLike<number>,
  candidates: readonly T[],
  k: number,
): Scored<T>[] {
  return candidates
    .map((candidate, order) => ({ candidate, order, score: cosine(query, candidate.vector) }))
    .sort((x, y) => y.score - x.score || x.order - y.order)
    .slice(0, Math.max(0, k))
    .map(({ candidate, score }) => ({ ...candidate, score }));
}
