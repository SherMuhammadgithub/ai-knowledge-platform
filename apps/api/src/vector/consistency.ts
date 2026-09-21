/**
 * Points in Qdrant whose chunk no longer exists in Postgres. They can appear when a document is re-read, or when
 * removing a document's points failed because Qdrant was unreachable. A search never shows them (the text is read
 * from Postgres), but they waste space and the counts would disagree. The sync script removes them.
 */
export function stalePointIds(pointIds: readonly string[], knownChunkIds: Iterable<string>): string[] {
  const known = new Set(knownChunkIds);
  return pointIds.filter((id) => !known.has(id));
}

/** What is missing: chunks that have a vector in Postgres but no point in Qdrant. */
export function missingPointIds(embeddedChunkIds: Iterable<string>, pointIds: readonly string[]): string[] {
  const present = new Set(pointIds);
  return [...embeddedChunkIds].filter((id) => !present.has(id));
}
