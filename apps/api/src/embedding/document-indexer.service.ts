import { Inject, Injectable, Logger } from "@nestjs/common";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import type { EmbeddingClient } from "../llm/types";
import { statusOf } from "../llm/resilience";
import type { TenantDb } from "../prisma/tenant-client";
import { TenantPrismaService } from "../prisma/tenant-prisma.service";
import type { DocumentJob } from "../queue/queue.constants";
import { ChunkEmbedder } from "./chunk-embedder";
import { EMBEDDINGS } from "./embedding.tokens";

/** "ready": every chunk has a vector and the document is searchable. "failed": marked Failed with a reason. "skipped": nothing to do. */
export type IndexOutcome = "ready" | "failed" | "skipped";

export type IndexAttempt = { number: number; max: number };

const TEMPORARY_FAILURE = "Creating embeddings kept failing because of a temporary problem. Try again in a few minutes.";

// Prisma error codes for "the row is gone".
const isRecordGone = (err: unknown) => ["P2025", "P2003"].includes((err as { code?: string })?.code ?? "");

/** A plain-language reason when the provider says the request itself can never work. Undefined means "may pass, retry". */
function permanentReason(err: unknown): string | undefined {
  switch (statusOf(err)) {
    case 400:
      return "The AI service refused the text of this document. It may contain something it cannot process.";
    case 401:
    case 403:
      return "The AI service refused the request. Check that the API key is valid.";
    case 404:
      return "The AI service does not know the embedding model. Check the model name in the settings.";
    default:
      return undefined;
  }
}

/**
 * The second step of the pipeline: gives a document's chunks their vectors, then marks the document Ready.
 * Runs in the worker, on its own queue, because a large document can take many minutes on the free tier.
 *
 * Like the processor, it is safe to run twice: it only does work for chunks that lack a vector, so a retry after a
 * crash or a rate-limit failure continues where the last run stopped, and paid vectors are never paid for again.
 */
@Injectable()
export class DocumentIndexerService {
  private readonly log = new Logger(DocumentIndexerService.name);
  private readonly embedder: ChunkEmbedder;

  constructor(
    private readonly tenant: TenantPrismaService,
    @Inject(EMBEDDINGS) client: EmbeddingClient,
    @Inject(ENV) env: Env,
  ) {
    this.embedder = new ChunkEmbedder(client, env.CHUNK_STRATEGY);
  }

  async index(job: DocumentJob, attempt: IndexAttempt = { number: 1, max: 1 }): Promise<IndexOutcome> {
    const db = this.tenant.for({ workspaceId: job.workspaceId });

    const doc = await db.document.findUnique({ where: { id: job.documentId }, select: { id: true, status: true } });
    if (!doc) {
      this.log.warn(`Document ${job.documentId} not found in workspace ${job.workspaceId}. Skipping.`);
      return "skipped";
    }
    if (doc.status !== "INDEXING") return "skipped"; // already Ready, failed, or not read yet

    try {
      const result = await this.embedder.embedDocument(db, doc.id, {
        onProgress: async ({ total, embedded }) => {
          // Also moves updatedAt, which tells the sweeper this document is alive.
          await db.document.update({ where: { id: doc.id }, data: { statusDetail: `Embedding ${embedded} of ${total} chunks` } });
        },
      });
      await db.document.update({ where: { id: doc.id }, data: { status: "READY", statusDetail: null } });
      this.log.log(
        `Document ${doc.id}: ${result.total} chunks, ${result.newVectors} embedded in ${result.calls} call(s), ${result.reusedFromCache} reused from the cache`,
      );
      return "ready";
    } catch (err) {
      if (isRecordGone(err)) return "skipped"; // deleted while we were working on it

      const reason = permanentReason(err);
      if (reason) {
        this.log.error(`Document ${doc.id}: the provider refused it (${String(err).slice(0, 200)})`);
        await this.markFailed(db, doc.id, reason);
        return "failed";
      }
      if (attempt.number >= attempt.max) {
        this.log.error(`Document ${doc.id}: giving up after ${attempt.number} attempts: ${String(err).slice(0, 300)}`);
        await this.markFailed(db, doc.id, TEMPORARY_FAILURE);
        return "failed";
      }
      this.log.warn(`Document ${doc.id}: attempt ${attempt.number} of ${attempt.max} failed: ${String(err).slice(0, 300)}`);
      throw err; // the queue tries again, and vectors already saved are kept
    }
  }

  private async markFailed(db: TenantDb, documentId: string, reason: string) {
    try {
      await db.document.update({ where: { id: documentId }, data: { status: "FAILED", statusDetail: reason } });
    } catch (err) {
      if (!isRecordGone(err)) throw err;
    }
  }
}
