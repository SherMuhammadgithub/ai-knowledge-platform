import type { ChunkStrategy } from "../chunking";
import type { EmbeddingClient } from "../llm/types";
import type { TenantDb } from "../prisma/tenant-client";
import { encodeVector } from "./vector";

// Texts per provider call. Small on purpose: after each group the vectors and the progress are saved, so a crash
// or a rate-limit failure loses at most one group, and the screen can show real progress.
const GROUP_SIZE = 16;

export type EmbedProgress = { total: number; embedded: number };

export type EmbedResult = {
  /** Chunks of the document (for the configured strategy). */
  total: number;
  /** Chunks that already had a vector under the current setup before this run. */
  alreadyEmbedded: number;
  /** Chunks that got their vector from the cache: the same text was embedded before, so no provider call. */
  reusedFromCache: number;
  /** Distinct texts sent to the provider in this run. */
  newVectors: number;
  /** Provider calls made in this run. */
  calls: number;
};

/**
 * Gives every chunk of a document a vector.
 *
 *  1. Chunks that already have a vector under the current setup are left alone.
 *  2. The cache (chunk_embeddings) is asked about the rest, by text fingerprint. Known texts cost nothing.
 *  3. Only the missing texts go to the provider, a few at a time, each group saved as soon as it arrives.
 *
 * Safe to run again after a failure: it continues where it stopped, and never pays twice for the same text.
 * Plain class on purpose (no Nest): the worker, the backfill script and the tests all use it.
 * Everything goes through the workspace-scoped client.
 */
export class ChunkEmbedder {
  constructor(
    private readonly client: EmbeddingClient,
    private readonly strategy: ChunkStrategy,
  ) {}

  get setupId(): string {
    return this.client.setupId;
  }

  async embedDocument(
    db: TenantDb,
    documentId: string,
    options: { onProgress?: (progress: EmbedProgress) => Promise<void> | void } = {},
  ): Promise<EmbedResult> {
    const { strategy } = this;
    const setupId = this.client.setupId;

    const chunks = await db.documentChunk.findMany({
      where: { documentId, strategy },
      orderBy: { chunkIndex: "asc" },
      select: { text: true, contentHash: true, embeddedWith: true },
    });
    const pending = chunks.filter((c) => c.embeddedWith !== setupId);
    const result: EmbedResult = {
      total: chunks.length,
      alreadyEmbedded: chunks.length - pending.length,
      reusedFromCache: 0,
      newVectors: 0,
      calls: 0,
    };
    if (pending.length === 0) return result;
    let embedded = result.alreadyEmbedded;

    // Step 2: which of these texts already have a vector?
    const hashes = [...new Set(pending.map((c) => c.contentHash))];
    const cached = await db.chunkEmbedding.findMany({
      where: { contentHash: { in: hashes }, setupId },
      select: { contentHash: true },
    });
    const known = new Set(cached.map((c) => c.contentHash));
    if (known.size > 0) {
      await db.documentChunk.updateMany({
        where: { documentId, strategy, contentHash: { in: [...known] } },
        data: { embeddedWith: setupId },
      });
      result.reusedFromCache = pending.filter((c) => known.has(c.contentHash)).length;
      embedded += result.reusedFromCache;
      await options.onProgress?.({ total: result.total, embedded });
    }

    // Step 3: embed each missing text once (two chunks with the same text share one vector).
    const missing = new Map<string, string>(); // hash -> text
    for (const c of pending) if (!known.has(c.contentHash) && !missing.has(c.contentHash)) missing.set(c.contentHash, c.text);
    const entries = [...missing.entries()];

    for (let i = 0; i < entries.length; i += GROUP_SIZE) {
      const group = entries.slice(i, i + GROUP_SIZE);
      const vectors = await this.client.embed(
        group.map(([, text]) => text),
        "document",
      );
      result.calls++;
      if (vectors.length !== group.length) throw new Error(`Asked for ${group.length} vectors, got ${vectors.length}`);

      const groupHashes = group.map(([hash]) => hash);
      await db.transaction(async (tx) => {
        await tx.chunkEmbedding.createMany({
          data: group.map(([hash], k) => ({
            workspaceId: db.workspaceId, // required by the types. The scoped client overwrites it anyway.
            contentHash: hash,
            setupId,
            vector: encodeVector(vectors[k]),
          })),
          skipDuplicates: true, // another worker may have saved the same text a moment ago
        });
        await tx.documentChunk.updateMany({
          where: { documentId, strategy, contentHash: { in: groupHashes } },
          data: { embeddedWith: setupId },
        });
      });
      result.newVectors += group.length;
      embedded += pending.filter((c) => groupHashes.includes(c.contentHash)).length;
      await options.onProgress?.({ total: result.total, embedded });
    }

    // A last look: every chunk must have a vector now, or the caller must not call the document searchable.
    const remaining = await db.documentChunk.count({
      where: { documentId, strategy, OR: [{ embeddedWith: null }, { embeddedWith: { not: setupId } }] },
    });
    if (remaining > 0) throw new Error(`${remaining} chunks still have no vector after embedding`);
    return result;
  }
}
