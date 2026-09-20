import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import Redis from "ioredis";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { DocumentIndexerService } from "../embedding/document-indexer.service";
import { DocumentProcessorService } from "../processing/document-processor.service";
import { DOCUMENT_QUEUE_NAME, type DocumentJob, EMBEDDING_QUEUE_NAME } from "../queue/queue.constants";

type Attempt = { number: number; max: number };

/** A consumer for one queue: waits for jobs and hands each to `handle`. Both workers below are built from it. */
function createQueueWorker(options: {
  queueName: string;
  handle: (job: DocumentJob, attempt: Attempt) => Promise<string>;
  redisUrl: string;
  prefix: string;
  concurrency: number;
  lockDurationMs: number;
  log?: Logger;
}) {
  // A worker holds a blocking connection, so it needs retries switched off (BullMQ requires null here).
  const connection = new Redis(options.redisUrl, { maxRetriesPerRequest: null });
  connection.on("error", (err) => options.log?.warn(`Redis: ${err.message}`));

  const worker = new Worker<DocumentJob, string>(
    options.queueName,
    async (job) => {
      const outcome = await options.handle(job.data, { number: job.attemptsMade + 1, max: job.opts.attempts ?? 1 });
      options.log?.log(`[${options.queueName}] document ${job.data.documentId}: ${outcome}`);
      return outcome;
    },
    {
      connection,
      prefix: options.prefix,
      concurrency: options.concurrency,
      lockDuration: options.lockDurationMs,
    },
  );
  worker.on("error", (err) => options.log?.warn(`Worker: ${err.message}`));

  return {
    worker,
    async close() {
      await worker.close();
      connection.disconnect();
    },
  };
}

/**
 * Reads documents: takes each job from the processing queue and hands it to the processor.
 * Kept as a plain function so tests can start a real worker without starting a whole Nest process.
 */
export function createDocumentWorker(options: {
  processor: DocumentProcessorService;
  redisUrl: string;
  prefix: string;
  concurrency: number;
  timeoutSeconds: number;
  log?: Logger;
}) {
  return createQueueWorker({
    queueName: DOCUMENT_QUEUE_NAME,
    handle: (job, attempt) => options.processor.process(job, attempt),
    redisUrl: options.redisUrl,
    prefix: options.prefix,
    concurrency: options.concurrency,
    // A job may legitimately run for the whole processing timeout, so its lock must outlive that.
    lockDurationMs: (options.timeoutSeconds + 30) * 1000,
    log: options.log,
  });
}

/**
 * Creates vectors: takes each job from the embedding queue and hands it to the indexer. One job at a time, because
 * the provider limit (tokens per minute) is shared by all of them and the limiter lives in this process.
 */
export function createEmbeddingWorker(options: {
  indexer: DocumentIndexerService;
  redisUrl: string;
  prefix: string;
  log?: Logger;
}) {
  return createQueueWorker({
    queueName: EMBEDDING_QUEUE_NAME,
    handle: (job, attempt) => options.indexer.index(job, attempt),
    redisUrl: options.redisUrl,
    prefix: options.prefix,
    concurrency: 1,
    // BullMQ renews the lock while the worker is alive. This is how long a crashed worker's job stays locked.
    lockDurationMs: 5 * 60_000,
    log: options.log,
  });
}

@Injectable()
export class DocumentWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger("DocumentWorker");
  private running: { close(): Promise<void> }[] = [];

  constructor(
    private readonly processor: DocumentProcessorService,
    private readonly indexer: DocumentIndexerService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit() {
    this.running = [
      createDocumentWorker({
        processor: this.processor,
        redisUrl: this.env.REDIS_URL,
        prefix: this.env.QUEUE_PREFIX,
        concurrency: this.env.WORKER_CONCURRENCY,
        timeoutSeconds: this.env.PROCESSING_TIMEOUT_SECONDS,
        log: this.log,
      }),
      createEmbeddingWorker({
        indexer: this.indexer,
        redisUrl: this.env.REDIS_URL,
        prefix: this.env.QUEUE_PREFIX,
        log: this.log,
      }),
    ];
    this.log.log(
      `Worker ready: reading documents (${this.env.WORKER_CONCURRENCY} at a time) and creating embeddings (1 at a time).`,
    );
  }

  async onApplicationShutdown() {
    await Promise.all(this.running.map((w) => w.close())); // lets a running job finish before the process exits
  }
}
