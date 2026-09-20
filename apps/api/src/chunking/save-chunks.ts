import type { TenantTx } from "../prisma/tenant-client";
import type { ChunkDraft, ChunkStrategy } from "./index";

/**
 * Saves chunks for one document, replacing what was there (never appending, so a repeated run cannot double them).
 *
 * `only` limits the replacement to one strategy. The processor omits it: the pages just changed, so every
 * strategy's chunks for the document are stale. The rebuild script passes it, to add or refresh a single strategy.
 * Must run inside the caller's transaction so the pages, the chunks and the status change together.
 */
export async function replaceChunks(
  tx: Pick<TenantTx, "documentChunk">,
  workspaceId: string,
  documentId: string,
  drafts: ChunkDraft[],
  only?: ChunkStrategy,
) {
  await tx.documentChunk.deleteMany({ where: { documentId, ...(only && { strategy: only }) } });
  if (drafts.length === 0) return;
  await tx.documentChunk.createMany({
    data: drafts.map((d) => ({
      workspaceId, // required by the types. The scoped client overwrites it anyway.
      documentId,
      pageNumber: d.pageNumber,
      chunkIndex: d.chunkIndex,
      strategy: d.strategy,
      startChar: d.startChar,
      endChar: d.endChar,
      text: d.text,
      tokenEstimate: d.tokenEstimate,
      contentHash: d.contentHash,
    })),
  });
}
