import type { ChunkStrategy } from "../chunking";
import { decodeVector } from "../embedding/vector";
import type { EmbeddingClient } from "../llm/types";
import type { TenantDb } from "../prisma/tenant-client";
import { rankBySimilarity } from "./similarity";

export type SearchHit = {
  score: number;
  chunkId: string;
  documentId: string;
  documentName: string;
  pageNumber: number;
  chunkIndex: number;
  text: string;
};

/**
 * The plain search of Milestone 5: meaning search with no index, so every step is visible.
 *
 *  1. Turn the question into a vector (one provider call).
 *  2. Load the vectors of the workspace's chunks (only Ready documents, only under the current embedding setup).
 *  3. Compare the question with each one and keep the closest `k`.
 *
 * Everything is read through the workspace-scoped client, so a question can only ever find its own workspace's text.
 * Milestone 6 replaces steps 2 and 3 with Qdrant.
 */
export async function searchChunks(
  db: TenantDb,
  client: EmbeddingClient,
  strategy: ChunkStrategy,
  question: string,
  k = 5,
): Promise<SearchHit[]> {
  const setupId = client.setupId;
  const [queryVector] = await client.embed([question], "query");

  const chunks = await db.documentChunk.findMany({
    where: { strategy, embeddedWith: setupId, document: { status: "READY" } },
    select: {
      id: true,
      documentId: true,
      pageNumber: true,
      chunkIndex: true,
      text: true,
      contentHash: true,
      document: { select: { originalName: true } },
    },
    orderBy: [{ documentId: "asc" }, { chunkIndex: "asc" }],
  });
  if (chunks.length === 0) return [];

  const rows = await db.chunkEmbedding.findMany({
    where: { setupId, contentHash: { in: [...new Set(chunks.map((c) => c.contentHash))] } },
    select: { contentHash: true, vector: true },
  });
  const vectorByHash = new Map(rows.map((r) => [r.contentHash, decodeVector(r.vector, client.dimensions)]));

  const candidates = chunks.flatMap((c) => {
    const vector = vectorByHash.get(c.contentHash);
    return vector ? [{ ...c, vector }] : [];
  });

  return rankBySimilarity(queryVector, candidates, k).map((hit) => ({
    score: hit.score,
    chunkId: hit.id,
    documentId: hit.documentId,
    documentName: hit.document.originalName,
    pageNumber: hit.pageNumber,
    chunkIndex: hit.chunkIndex,
    text: hit.text,
  }));
}
