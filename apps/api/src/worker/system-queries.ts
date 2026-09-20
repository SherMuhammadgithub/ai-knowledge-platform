import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/** Documents nobody has touched for this long are considered stuck (never queued, or the worker died). */
export const STALE_AFTER_MS = 5 * 60_000;

/**
 * THE ONE PLACE that reads tenant tables without a workspace. It exists because the sweeper has to look across
 * all workspaces to find stuck documents. It returns ids only. Everything the worker does with a document
 * afterwards goes through the workspace-scoped client. A test fails if the plain client touches a tenant table
 * anywhere else in src/ (apps/api/test/tenant-client.spec.ts).
 */
@Injectable()
export class SystemQueries {
  constructor(private readonly prisma: PrismaService) {}

  findStaleDocuments(now: Date, limit = 100): Promise<{ id: string; workspaceId: string; status: string }[]> {
    const staleBefore = new Date(now.getTime() - STALE_AFTER_MS);
    return this.prisma.document.findMany({
      where: { status: { in: ["UPLOADED", "PROCESSING", "INDEXING"] }, updatedAt: { lt: staleBefore } },
      select: { id: true, workspaceId: true, status: true },
      orderBy: { updatedAt: "asc" },
      take: limit,
    });
  }

  /** Marks documents as recently handled, so the next sweep does not queue them again straight away. */
  async touch(ids: string[], now: Date): Promise<void> {
    if (!ids.length) return;
    await this.prisma.document.updateMany({ where: { id: { in: ids } }, data: { updatedAt: now } });
  }
}
