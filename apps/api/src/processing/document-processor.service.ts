import { Inject, Injectable, Logger } from "@nestjs/common";
import { type ChunkSettings, type ChunkStrategy, chunkPages, chunkSettingsFrom } from "../chunking";
import { replaceChunks } from "../chunking/save-chunks";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import type { TenantDb } from "../prisma/tenant-client";
import { TenantPrismaService } from "../prisma/tenant-prisma.service";
import type { DocumentJob } from "../queue/queue.constants";
import { STORAGE, type StorageService } from "../storage/storage.service";
import { PermanentProcessingError } from "./errors";
import { type ExtractedDocument, extractDocument } from "./extract-document";
import { DEFAULT_LIMITS, type ProcessingLimits } from "./limits";

/** "ready": text saved. "failed": marked Failed with a reason. "skipped": nothing to do (deleted, or already done). */
export type ProcessOutcome = "ready" | "failed" | "skipped";

/** Which try this is. BullMQ counts attempts, this service only needs to know whether another one will follow. */
export type Attempt = { number: number; max: number };

const TEMPORARY_FAILURE = "Processing kept failing because of a temporary problem. Try again in a few minutes.";

// Prisma error codes for "the row is gone": update of a missing row, or a write pointing at a deleted document.
const isRecordGone = (err: unknown) => ["P2025", "P2003"].includes((err as { code?: string })?.code ?? "");

/**
 * Turns one uploaded file into stored text: read the file, extract and clean it, cut the pages into chunks,
 * save pages and chunks, mark it Ready.
 *
 * Safe to run twice for the same document (queues deliver at least once):
 *  - a document that is already Ready is left alone
 *  - the pages, the chunks and the Ready status are written in one transaction, replacing any earlier ones,
 *    so a crash half way leaves nothing behind and a re-run gives the same result
 *
 * The workspace comes from the job and every query goes through the scoped client.
 */
@Injectable()
export class DocumentProcessorService {
  private readonly log = new Logger(DocumentProcessorService.name);
  private readonly limits: ProcessingLimits;
  private readonly strategy: ChunkStrategy;
  private readonly chunkSettings: ChunkSettings;

  constructor(
    private readonly tenant: TenantPrismaService,
    @Inject(STORAGE) private readonly storage: StorageService,
    @Inject(ENV) env: Env,
  ) {
    this.limits = { ...DEFAULT_LIMITS, maxPages: env.MAX_PDF_PAGES, timeoutMs: env.PROCESSING_TIMEOUT_SECONDS * 1000 };
    this.strategy = env.CHUNK_STRATEGY;
    this.chunkSettings = chunkSettingsFrom(env);
  }

  async process(job: DocumentJob, attempt: Attempt = { number: 1, max: 1 }): Promise<ProcessOutcome> {
    const db = this.tenant.for({ workspaceId: job.workspaceId });

    const doc = await db.document.findUnique({
      where: { id: job.documentId },
      select: { id: true, type: true, storageKey: true, status: true },
    });
    if (!doc) {
      this.log.warn(`Document ${job.documentId} not found in workspace ${job.workspaceId}. Skipping.`);
      return "skipped";
    }
    if (doc.status === "READY") return "skipped";

    try {
      await db.document.update({ where: { id: doc.id }, data: { status: "PROCESSING", statusDetail: null } });
      const bytes = await this.readFile(doc.storageKey);
      const result = await extractDocument(doc.type, bytes, this.limits);
      await this.savePages(db, doc.id, result);
      return "ready";
    } catch (err) {
      if (isRecordGone(err)) return "skipped"; // deleted while we were working on it

      if (err instanceof PermanentProcessingError) {
        await this.markFailed(db, doc.id, err.reason); // a problem with the file: retrying cannot help
        return "failed";
      }

      // Anything else is treated as temporary. Let the queue retry, until the last attempt.
      if (attempt.number >= attempt.max) {
        this.log.error(`Document ${doc.id}: giving up after ${attempt.number} attempts: ${String(err)}`);
        await this.markFailed(db, doc.id, TEMPORARY_FAILURE);
        return "failed";
      }
      this.log.warn(`Document ${doc.id}: attempt ${attempt.number} of ${attempt.max} failed: ${String(err)}`);
      throw err;
    }
  }

  private async readFile(storageKey: string): Promise<Buffer> {
    try {
      return await this.storage.read(storageKey);
    } catch (err) {
      if ((err as { code?: string })?.code === "ENOENT") {
        throw new PermanentProcessingError("The stored file is missing. Upload it again.");
      }
      throw err;
    }
  }

  private savePages(db: TenantDb, documentId: string, result: ExtractedDocument) {
    // Chunking is plain computation (no network), so it happens before the transaction opens.
    const chunks = chunkPages(
      result.pages.map((text, index) => ({ pageNumber: index + 1, text })),
      this.strategy,
      this.chunkSettings,
    );
    return db.transaction(async (tx) => {
      // Replace, never append: a repeated run must not double the pages or the chunks.
      await tx.documentPage.deleteMany({ where: { documentId } });
      await tx.documentPage.createMany({
        data: result.pages.map((text, index) => ({
          workspaceId: db.workspaceId, // required by the types. The scoped client overwrites it anyway.
          documentId,
          pageNumber: index + 1,
          text,
          charCount: text.length,
        })),
      });
      await replaceChunks(tx, db.workspaceId, documentId, chunks); // all strategies: the pages just changed
      await tx.document.update({
        where: { id: documentId },
        data: {
          status: "READY",
          statusDetail: null,
          pageCount: result.pages.length,
          charCount: result.charCount,
          processedAt: new Date(),
        },
      });
    });
  }

  private async markFailed(db: TenantDb, documentId: string, reason: string) {
    try {
      await db.document.update({ where: { id: documentId }, data: { status: "FAILED", statusDetail: reason } });
    } catch (err) {
      if (!isRecordGone(err)) throw err;
    }
  }
}
