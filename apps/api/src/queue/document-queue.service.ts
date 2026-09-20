import { Inject, Injectable, Logger, OnApplicationShutdown } from "@nestjs/common";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import {
  DOCUMENT_QUEUE_NAME,
  type DocumentJob,
  EMBEDDING_JOB_OPTIONS,
  EMBEDDING_QUEUE_NAME,
  JOB_OPTIONS,
} from "./queue.constants";

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
  private readonly embeddingQueue: Queue<DocumentJob>;

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
    this.embeddingQueue = new Queue<DocumentJob>(EMBEDDING_QUEUE_NAME, {
      connection: this.connection,
      prefix: env.QUEUE_PREFIX,
      defaultJobOptions: EMBEDDING_JOB_OPTIONS,
    });
    this.embeddingQueue.on("error", (err) => this.log.warn(`Embedding queue: ${err.message}`));
  }

  /** Reading the file: extract, clean, chunk. Rejects if the job could not be added within a few seconds. */
  enqueue(job: DocumentJob): Promise<void> {
    return this.add(this.queue, "process", job);
  }

  /** Creating the vectors for a document's chunks. Rejects like enqueue(). */
  enqueueEmbedding(job: DocumentJob): Promise<void> {
    return this.add(this.embeddingQueue, "embed", job);
  }

  private async add(queue: Queue<DocumentJob>, name: string, job: DocumentJob): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Timed out adding the job to the queue")), ENQUEUE_TIMEOUT_MS);
    });
    try {
      await Promise.race([queue.add(name, job), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Counts of jobs by state. Used by tests and for a quick look at what is queued. */
  counts() {
    return this.queue.getJobCounts("waiting", "active", "delayed", "failed", "completed");
  }

  countsEmbedding() {
    return this.embeddingQueue.getJobCounts("waiting", "active", "delayed", "failed", "completed");
  }

  /** Removes every job from both queues. Only for tests, which use their own queue prefix. */
  async clear(): Promise<void> {
    await this.queue.obliterate({ force: true });
    await this.embeddingQueue.obliterate({ force: true });
  }

  async onApplicationShutdown() {
    await this.queue.close();
    await this.embeddingQueue.close();
    this.connection.disconnect();
  }
}
