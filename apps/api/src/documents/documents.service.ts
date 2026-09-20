import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import type { WorkspaceAuth } from "../auth/auth.types";
import { CHUNK_STRATEGIES, type ChunkStrategy } from "../chunking";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { TenantPrismaService } from "../prisma/tenant-prisma.service";
import { DocumentQueueService } from "../queue/document-queue.service";
import { STORAGE, type StorageService } from "../storage/storage.service";
import {
  cleanFileName,
  detectKind,
  EXTENSION_KIND,
  extensionOf,
} from "./file-type";
import type { UploadedFileData } from "./uploaded-file";

// The chunk count is for the strategy the worker uses, so a second strategy stored for comparison is not counted.
const selectFor = (strategy: ChunkStrategy) =>
  ({
    id: true,
    originalName: true,
    type: true,
    sizeBytes: true,
    status: true,
    statusDetail: true,
    pageCount: true,
    charCount: true,
    processedAt: true,
    createdAt: true,
    uploadedBy: { select: { id: true, name: true, email: true } },
    _count: { select: { chunks: { where: { strategy } } } },
  }) as const;

type Row = {
  id: string;
  originalName: string;
  type: string;
  sizeBytes: number;
  status: string;
  statusDetail: string | null;
  pageCount: number | null;
  charCount: number | null;
  processedAt: Date | null;
  createdAt: Date;
  uploadedBy: { id: string; name: string | null; email: string } | null;
  _count: { chunks: number };
};

const toDto = (r: Row) => ({
  id: r.id,
  name: r.originalName,
  type: r.type,
  sizeBytes: r.sizeBytes,
  status: r.status,
  statusDetail: r.statusDetail,
  pageCount: r.pageCount,
  charCount: r.charCount,
  chunkCount: r._count.chunks,
  processedAt: r.processedAt,
  createdAt: r.createdAt,
  uploadedBy: r.uploadedBy,
});

@Injectable()
export class DocumentsService {
  private readonly log = new Logger(DocumentsService.name);
  private readonly strategy: ChunkStrategy;
  private readonly select;

  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly queue: DocumentQueueService,
    @Inject(STORAGE) private readonly storage: StorageService,
    @Inject(ENV) env: Env,
  ) {
    this.strategy = env.CHUNK_STRATEGY;
    this.select = selectFor(this.strategy);
  }

  async list(actor: WorkspaceAuth) {
    const rows = await this.tenant
      .for(actor)
      .document.findMany({
        orderBy: { createdAt: "desc" },
        select: this.select,
      });
    return rows.map(toDto);
  }

  async upload(actor: WorkspaceAuth, file: UploadedFileData | undefined) {
    if (!file) throw new BadRequestException("Choose a file to upload");
    if (file.size === 0) throw new BadRequestException("This file is empty");

    const name = cleanFileName(file.originalname);
    const expected = EXTENSION_KIND[extensionOf(name)];
    if (!expected)
      throw new UnsupportedMediaTypeException(
        "Only PDF, DOCX and TXT files are supported",
      );

    // The bytes decide what the file is. A mismatch (an .exe named .pdf) is refused.
    if (detectKind(file.buffer) !== expected) {
      throw new UnsupportedMediaTypeException(
        `This file is not a valid ${expected} file`,
      );
    }

    const contentHash = createHash("sha256").update(file.buffer).digest("hex");
    const db = this.tenant.for(actor);

    const existing = await db.document.findFirst({
      where: { contentHash },
      select: { originalName: true },
    });
    if (existing)
      throw new ConflictException(
        `This file is already in the workspace as "${existing.originalName}"`,
      );

    // We choose the id and the storage key. Nothing from the upload becomes part of a path.
    const id = randomUUID();
    const storageKey = `${actor.workspaceId}/${id}`;
    await this.storage.put(storageKey, file.buffer);

    let row: Row;
    try {
      row = await db.document.create({
        data: {
          id,
          // Required by the types. The scoped client overwrites it with the caller's workspace anyway.
          workspaceId: actor.workspaceId,
          uploadedById: actor.userId,
          originalName: name,
          type: expected,
          sizeBytes: file.size,
          contentHash,
          storageKey,
        },
        select: this.select,
      });
    } catch (err) {
      await this.storage.delete(storageKey).catch(() => undefined); // do not leave an orphan file behind
      // Two identical uploads at once: the unique index lets one through and refuses the other.
      if ((err as { code?: string })?.code === "P2002") {
        throw new ConflictException("This file is already in the workspace");
      }
      throw err;
    }

    await this.enqueue(actor.workspaceId, id);
    return toDto(row);
  }

  /** A failed document can be tried again, by whoever may delete it. */
  async retry(actor: WorkspaceAuth, id: string) {
    const db = this.tenant.for(actor);
    const doc = await db.document.findUnique({
      where: { id },
      select: { id: true, status: true, uploadedById: true },
    });
    if (!doc) throw new NotFoundException("Document not found");
    this.assertCanManage(actor, doc.uploadedById);
    if (doc.status !== "FAILED")
      throw new ConflictException(
        "Only documents that failed can be tried again",
      );

    const row = await db.document.update({
      where: { id },
      data: { status: "UPLOADED", statusDetail: null },
      select: this.select,
    });
    await this.enqueue(actor.workspaceId, id);
    return toDto(row);
  }

  /** The text the worker extracted, page by page. Makes the pipeline visible: what was actually read. */
  async pages(actor: WorkspaceAuth, id: string) {
    const db = this.tenant.for(actor);
    const doc = await db.document.findUnique({
      where: { id },
      select: this.select,
    });
    if (!doc) throw new NotFoundException("Document not found");
    const pages = await db.documentPage.findMany({
      where: { documentId: id },
      orderBy: { pageNumber: "asc" },
      select: { pageNumber: true, text: true },
    });
    return { document: toDto(doc), pages };
  }

  /**
   * The chunks of a document, in order. Makes the chunking visible: exactly what will be embedded.
   * `overlapWithPrevious` is how many characters at the start of a chunk repeat the end of the previous chunk on the same page.
   */
  async chunks(actor: WorkspaceAuth, id: string, requested?: string) {
    const strategy = this.parseStrategy(requested);
    const db = this.tenant.for(actor);
    const doc = await db.document.findUnique({
      where: { id },
      select: this.select,
    });
    if (!doc) throw new NotFoundException("Document not found");
    const rows = await db.documentChunk.findMany({
      where: { documentId: id, strategy },
      orderBy: { chunkIndex: "asc" },
      select: {
        chunkIndex: true,
        pageNumber: true,
        startChar: true,
        endChar: true,
        text: true,
        tokenEstimate: true,
      },
    });
    const chunks = rows.map((c, i) => {
      const before = rows[i - 1];
      const shared =
        before && before.pageNumber === c.pageNumber
          ? before.endChar - c.startChar
          : 0;
      return { ...c, overlapWithPrevious: Math.max(0, shared) };
    });
    return { document: toDto(doc), strategy, chunks };
  }

  private parseStrategy(requested?: string): ChunkStrategy {
    if (requested === undefined || requested === "") return this.strategy;
    const found = CHUNK_STRATEGIES.find((s) => s === requested);
    if (!found)
      throw new BadRequestException(
        `strategy must be one of: ${CHUNK_STRATEGIES.join(", ")}`,
      );
    return found;
  }

  async remove(actor: WorkspaceAuth, id: string): Promise<void> {
    const db = this.tenant.for(actor);
    // Scoped lookup: a document id from another workspace is simply "not found".
    const doc = await db.document.findUnique({
      where: { id },
      select: { id: true, uploadedById: true, storageKey: true },
    });
    if (!doc) throw new NotFoundException("Document not found");
    this.assertCanManage(actor, doc.uploadedById);

    await db.document.delete({ where: { id } }); // its pages go with it (cascade)
    // Row first, file second. A failure here leaves a harmless orphan file, never a row pointing at nothing.
    await this.storage.delete(doc.storageKey).catch((err) => {
      this.log.warn(`Could not delete file ${doc.storageKey}: ${String(err)}`);
    });
  }

  // Admins and owners manage any document. A member manages only their own uploads.
  private assertCanManage(actor: WorkspaceAuth, uploadedById: string | null) {
    if (actor.role === "MEMBER" && uploadedById !== actor.userId) {
      throw new ForbiddenException(
        "Only admins, owners and the person who uploaded it can do this to the document",
      );
    }
  }

  // A failure to queue must not undo a successful upload. The worker's sweeper finds the document later.
  private async enqueue(workspaceId: string, documentId: string) {
    try {
      await this.queue.enqueue({ workspaceId, documentId });
    } catch (err) {
      this.log.error(
        `Could not queue document ${documentId}. The sweeper will retry it. ${String(err)}`,
      );
    }
  }
}
