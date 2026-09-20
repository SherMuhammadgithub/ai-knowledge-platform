import { Inject, Injectable, Logger, OnApplicationShutdown } from "@nestjs/common";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { DOCUMENT_QUEUE_NAME, type DocumentJob, JOB_OPTIONS } from "./queue.constants";

const ENQUEUE_TIMEOUT_MS = 3_000;

/**
 * The producer side of the queue: adds jobs. Used by the API (after an upload) and by the worker's sweeper.
 * The processing itself happens in a separate worker process (src/worker).
 */
@Injectable()
export class DocumentQueueService implements OnApplicationShutdown {
  private readonly log = new Logger(DocumentQueueService.name);
  private readonly connection: Redis;
  private readonly queue: Queue<DocumentJob>;

  constructor(@Inject(ENV) env: Env) {
    // Fail fast when Redis is down: an upload must not hang waiting for the queue.
    this.connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
    this.connection.on("error", (err) => this.log.warn(`Redis: ${err.message}`));
    this.queue = new Queue<DocumentJob>(DOCUMENT_QUEUE_NAME, {
      connection: this.connection,
      prefix: env.QUEUE_PREFIX,
      defaultJobOptions: JOB_OPTIONS,
    });
    this.queue.on("error", (err) => this.log.warn(`Queue: ${err.message}`));
  }

  /** Rejects if the job could not be added within a few seconds. Callers decide what that means for them. */
  async enqueue(job: DocumentJob): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Timed out adding the job to the queue")), ENQUEUE_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.queue.add("process", job), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Counts of jobs by state. Used by tests and for a quick look at what is queued. */
  counts() {
    return this.queue.getJobCounts("waiting", "active", "delayed", "failed", "completed");
  }

  /** Removes every job. Only for tests, which use their own queue prefix. */
  async clear(): Promise<void> {
    await this.queue.obliterate({ force: true });
  }

  async onApplicationShutdown() {
    await this.queue.close();
    this.connection.disconnect();
  }
}
