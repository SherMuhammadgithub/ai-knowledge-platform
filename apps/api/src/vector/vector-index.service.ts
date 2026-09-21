import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { QdrantClient } from "@qdrant/js-client-rest";
import type { ChunkStrategy } from "../chunking";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { decodeVector } from "../embedding/vector";
import type { TenantDb } from "../prisma/tenant-client";

/**
 * What is stored next to each vector in Qdrant. Deliberately small: ids and positions, never the chunk text.
 * Postgres is the source of truth for text, and Qdrant is a search index that can be rebuilt from it.
 */
export type ChunkPayload = {
  workspace_id: string;
  document_id: string;
  chunk_id: string;
  chunk_index: number;
  page: number;
  strategy: ChunkStrategy;
  /** The embedding setup (model, dimensions, wording) the vector was made with. Vectors of different setups never mix. */
  setup_id: string;
};

export type VectorHit = { chunkId: string; documentId: string; score: number; page: number; chunkIndex: number };

/** Anything that goes wrong talking to Qdrant. It has no HTTP status on purpose, so callers treat it as a temporary problem. */
export class VectorIndexError extends Error {
  constructor(what: string, cause: unknown) {
    super(`Search index problem (${what}): ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "VectorIndexError";
  }
}

const BATCH = 64;

const equals = (key: string, value: string) => ({ key, match: { value } });

/**
 * The search index (Qdrant): one collection for every workspace.
 *
 * Isolation: every search filters on the workspace, and the workspace can only come from a workspace-scoped client
 * (`db.workspaceId`), never from a plain parameter. The filter also names the embedding setup and the chunking
 * strategy, because vectors of different setups or strategies must not be compared or mixed.
 *
 * A point's id is the chunk's id, so writing a chunk again updates it instead of duplicating it.
 */
@Injectable()
export class VectorIndexService implements OnModuleInit {
  private readonly log = new Logger(VectorIndexService.name);
  private readonly client: QdrantClient;
  readonly collection: string;
  private readonly dimensions: number;
  private ready?: Promise<void>;

  constructor(@Inject(ENV) env: Env) {
    this.client = new QdrantClient({ url: env.QDRANT_URL });
    this.collection = env.QDRANT_COLLECTION;
    this.dimensions = env.EMBEDDING_DIMENSIONS;
  }

  async onModuleInit() {
    // The API must start even when Qdrant is down. Uploads still work, and indexing retries until it is back.
    await this.ensureCollection().catch((err) => this.log.warn(`Qdrant is not reachable yet: ${String(err)}`));
  }

  /** Creates the collection and its indexes if they are missing, and checks an existing one has the right shape. */
  ensureCollection(): Promise<void> {
    this.ready ??= this.createOrVerify().catch((err) => {
      this.ready = undefined; // try again next time
      throw err instanceof VectorIndexError ? err : new VectorIndexError("preparing the collection", err);
    });
    return this.ready;
  }

  private async createOrVerify() {
    const { exists } = await this.client.collectionExists(this.collection);
    if (!exists) {
      try {
        await this.client.createCollection(this.collection, { vectors: { size: this.dimensions, distance: "Cosine" } });
        // The tenant index makes Qdrant keep each workspace's points together on disk.
        await this.client.createPayloadIndex(this.collection, {
          field_name: "workspace_id",
          field_schema: { type: "keyword", is_tenant: true },
          wait: true,
        });
        for (const field of ["document_id", "strategy", "setup_id"]) {
          await this.client.createPayloadIndex(this.collection, { field_name: field, field_schema: "keyword", wait: true });
        }
        this.log.log(`Created the "${this.collection}" collection (${this.dimensions} dimensions, cosine)`);
      } catch (err) {
        // The API and the worker can start at the same moment. If the other one won, that is fine: check what it made.
        if (!(await this.client.collectionExists(this.collection)).exists) throw err;
      }
    }
    const info = await this.client.getCollection(this.collection);
    const vectors = info.config.params.vectors as { size?: number; distance?: string } | undefined;
    if (vectors?.size !== this.dimensions || vectors?.distance !== "Cosine") {
      throw new VectorIndexError(
        "checking the collection",
        `"${this.collection}" has size ${vectors?.size} and distance ${vectors?.distance}, expected ${this.dimensions} and Cosine. Use another collection name or rebuild it.`,
      );
    }
  }

  /**
   * Makes Qdrant match Postgres for one document: writes a point for every chunk that has a vector under `setupId`,
   * then removes the document's points whose chunk no longer exists (after a re-chunk). Write first, delete second,
   * so a search in between never sees a document with no points. Safe to run again.
   */
  async syncDocument(db: TenantDb, documentId: string, setupId: string, strategy: ChunkStrategy): Promise<{ written: number; removed: number }> {
    await this.ensureCollection();
    try {
      const allIds = (await db.documentChunk.findMany({ where: { documentId }, select: { id: true } })).map((c) => c.id);
      const chunks = await db.documentChunk.findMany({
        where: { documentId, strategy, embeddedWith: setupId },
        orderBy: { chunkIndex: "asc" },
        select: { id: true, chunkIndex: true, pageNumber: true, contentHash: true },
      });
      const vectors = new Map(
        (
          await db.chunkEmbedding.findMany({
            where: { setupId, contentHash: { in: [...new Set(chunks.map((c) => c.contentHash))] } },
            select: { contentHash: true, vector: true },
          })
        ).map((v) => [v.contentHash, Array.from(decodeVector(v.vector, this.dimensions))]),
      );

      const points = chunks.flatMap((c) => {
        const vector = vectors.get(c.contentHash);
        if (!vector) return []; // no vector: the embedding step did not finish for this chunk
        const payload: ChunkPayload = {
          workspace_id: db.workspaceId,
          document_id: documentId,
          chunk_id: c.id,
          chunk_index: c.chunkIndex,
          page: c.pageNumber,
          strategy,
          setup_id: setupId,
        };
        return [{ id: c.id, vector, payload }];
      });
      for (let i = 0; i < points.length; i += BATCH) {
        await this.client.upsert(this.collection, { wait: true, points: points.slice(i, i + BATCH) });
      }

      const before = await this.countForDocument(db.workspaceId, documentId);
      await this.client.delete(this.collection, {
        wait: true,
        filter: { must: [equals("workspace_id", db.workspaceId), equals("document_id", documentId)], must_not: [{ has_id: allIds }] },
      });
      const after = await this.countForDocument(db.workspaceId, documentId);
      return { written: points.length, removed: Math.max(0, before - after) };
    } catch (err) {
      throw err instanceof VectorIndexError ? err : new VectorIndexError("writing a document", err);
    }
  }

  /** Removes every point of one document. Used when the document is deleted. */
  async deleteDocument(workspaceId: string, documentId: string): Promise<void> {
    await this.ensureCollection();
    try {
      await this.client.delete(this.collection, {
        wait: true,
        filter: { must: [equals("workspace_id", workspaceId), equals("document_id", documentId)] },
      });
    } catch (err) {
      throw new VectorIndexError("deleting a document", err);
    }
  }

  /** Removes specific points by chunk id. Used by the consistency script for points whose chunk no longer exists. */
  async deletePoints(chunkIds: string[]): Promise<void> {
    if (chunkIds.length === 0) return;
    await this.ensureCollection();
    try {
      await this.client.delete(this.collection, { wait: true, points: chunkIds });
    } catch (err) {
      throw new VectorIndexError("deleting points", err);
    }
  }

  /**
   * Meaning search inside one workspace. The workspace comes from the scoped client, so there is no parameter that
   * could name another one, and no way to search without it. `exact` compares every point instead of using the index.
   */
  async search(
    db: TenantDb,
    options: { vector: number[]; setupId: string; strategy: ChunkStrategy; limit: number; exact?: boolean },
  ): Promise<VectorHit[]> {
    await this.ensureCollection();
    try {
      const result = await this.client.query(this.collection, {
        query: options.vector,
        limit: options.limit,
        with_payload: true,
        params: options.exact ? { exact: true } : undefined,
        filter: {
          must: [equals("workspace_id", db.workspaceId), equals("setup_id", options.setupId), equals("strategy", options.strategy)],
        },
      });
      return result.points.map((p) => {
        const payload = p.payload as unknown as ChunkPayload;
        return { chunkId: payload.chunk_id, documentId: payload.document_id, score: p.score, page: payload.page, chunkIndex: payload.chunk_index };
      });
    } catch (err) {
      throw new VectorIndexError("searching", err);
    }
  }

  async countForDocument(workspaceId: string, documentId: string): Promise<number> {
    const { count } = await this.client.count(this.collection, {
      exact: true,
      filter: { must: [equals("workspace_id", workspaceId), equals("document_id", documentId)] },
    });
    return count;
  }

  /** Points per workspace: the number the consistency check compares with Postgres. */
  async countForWorkspace(workspaceId: string, strategy?: ChunkStrategy, setupId?: string): Promise<number> {
    await this.ensureCollection();
    const must = [equals("workspace_id", workspaceId), ...(strategy ? [equals("strategy", strategy)] : []), ...(setupId ? [equals("setup_id", setupId)] : [])];
    try {
      return (await this.client.count(this.collection, { exact: true, filter: { must } })).count;
    } catch (err) {
      throw new VectorIndexError("counting", err);
    }
  }

  /** Every point id of one workspace (for the consistency check). */
  async listPointIds(workspaceId: string): Promise<string[]> {
    await this.ensureCollection();
    const ids: string[] = [];
    let offset: string | number | undefined;
    try {
      do {
        const page = await this.client.scroll(this.collection, {
          limit: 256,
          offset,
          with_payload: false,
          with_vector: false,
          filter: { must: [equals("workspace_id", workspaceId)] },
        });
        ids.push(...page.points.map((p) => String(p.id)));
        offset = (page.next_page_offset as string | number | null | undefined) ?? undefined;
      } while (offset !== undefined);
    } catch (err) {
      throw new VectorIndexError("listing points", err);
    }
    return ids;
  }

  /** Deletes the whole collection. Only for tests, which use a collection of their own. */
  async dropCollection(): Promise<void> {
    this.ready = undefined;
    await this.client.deleteCollection(this.collection).catch(() => undefined);
  }
}
