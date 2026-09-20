import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { DocumentQueueService } from "../queue/document-queue.service";
import { SystemQueries } from "./system-queries";

const SWEEP_INTERVAL_MS = 60_000;

/**
 * The safety net. Normally the API queues a job right after an upload. But Redis can be down at that moment,
 * or the worker can die half way through. Every minute this looks for documents that are still Uploaded or
 * Processing after 5 minutes and queues them again. Processing is safe to repeat, so a duplicate is harmless.
 */
@Injectable()
export class SweeperService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(SweeperService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly system: SystemQueries,
    private readonly queue: DocumentQueueService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.safeRun(), SWEEP_INTERVAL_MS);
    this.timer.unref();
    void this.safeRun(); // catch up on anything left over from before the worker started
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  async runOnce(now = new Date()): Promise<number> {
    const stale = await this.system.findStaleDocuments(now);
    const queued: string[] = [];
    for (const doc of stale) {
      try {
        await this.queue.enqueue({ documentId: doc.id, workspaceId: doc.workspaceId });
        queued.push(doc.id);
      } catch (err) {
        this.log.warn(`Could not queue document ${doc.id}: ${String(err)}`);
      }
    }
    await this.system.touch(queued, now);
    if (queued.length) this.log.log(`Sweeper queued ${queued.length} stuck document(s) again`);
    return queued.length;
  }

  private async safeRun() {
    try {
      await this.runOnce();
    } catch (err) {
      this.log.warn(`Sweep failed, will try again: ${String(err)}`);
    }
  }
}
