import type { ChunkStrategy } from "../chunking";
import type { EmbeddingClient } from "../llm/types";
import type { TenantDb } from "../prisma/tenant-client";
import type { VectorIndexService } from "../vector/vector-index.service";
import type { SearchHit } from "./plain-search";

/**
 * Meaning search through Qdrant.
 *
 *  1. Turn the question into a vector (one provider call).
 *  2. Ask Qdrant for the closest points in this workspace (same setup, same strategy).
 *  3. Read the chunk text and the document name from Postgres, the source of truth. Qdrant holds no text.
 *
 * Only Ready documents are returned, like the plain search, so a document that is being read again does not show up
 * half finished. The result has the same shape as `searchChunks`, so the two can be compared.
 */
export async function searchChunksWithIndex(
  db: TenantDb,
  index: VectorIndexService,
  client: EmbeddingClient,
  strategy: ChunkStrategy,
  question: string,
  k = 5,
  options: { exact?: boolean } = {},
): Promise<SearchHit[]> {
  const [vector] = await client.embed([question], "query");
  return searchChunksByVector(db, index, client.setupId, strategy, vector, k, options);
}

/** Steps 2 and 3 for a question that has already been turned into a vector (the evaluation harness embeds all its questions at once). */
export async function searchChunksByVector(
  db: TenantDb,
  index: VectorIndexService,
  setupId: string,
  strategy: ChunkStrategy,
  vector: number[],
  k = 5,
  options: { exact?: boolean } = {},
): Promise<SearchHit[]> {
  const hits = await index.search(db, { vector, setupId, strategy, limit: k, exact: options.exact });
  if (hits.length === 0) return [];

  const rows = await db.documentChunk.findMany({
    where: { id: { in: hits.map((h) => h.chunkId) }, document: { status: "READY" } },
    select: { id: true, documentId: true, pageNumber: true, chunkIndex: true, text: true, document: { select: { originalName: true } } },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return hits.flatMap((h) => {
    const row = byId.get(h.chunkId);
    if (!row) return []; // the point is stale or the document is not Ready: skip it
    return [
      {
        score: h.score,
        chunkId: row.id,
        documentId: row.documentId,
        documentName: row.document.originalName,
        pageNumber: row.pageNumber,
        chunkIndex: row.chunkIndex,
        text: row.text,
      },
    ];
  });
}
