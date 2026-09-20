import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import Redis from "ioredis";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { DocumentProcessorService } from "../processing/document-processor.service";
import { DOCUMENT_QUEUE_NAME, type DocumentJob } from "../queue/queue.constants";

/**
 * Creates the consumer: it waits for jobs on the queue and hands each one to the processor.
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
  // A worker holds a blocking connection, so it needs retries switched off (BullMQ requires null here).
  const connection = new Redis(options.redisUrl, { maxRetriesPerRequest: null });
  connection.on("error", (err) => options.log?.warn(`Redis: ${err.message}`));

  const worker = new Worker<DocumentJob, string>(
    DOCUMENT_QUEUE_NAME,
    async (job) => {
      const outcome = await options.processor.process(job.data, {
        number: job.attemptsMade + 1,
        max: job.opts.attempts ?? 1,
      });
      options.log?.log(`Document ${job.data.documentId}: ${outcome}`);
      return outcome;
    },
    {
      connection,
      prefix: options.prefix,
      concurrency: options.concurrency,
      // A job may legitimately run for the whole processing timeout, so its lock must outlive that.
      lockDuration: (options.timeoutSeconds + 30) * 1000,
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

@Injectable()
export class DocumentWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger("DocumentWorker");
  private running?: ReturnType<typeof createDocumentWorker>;

  constructor(
    private readonly processor: DocumentProcessorService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit() {
    this.running = createDocumentWorker({
      processor: this.processor,
      redisUrl: this.env.REDIS_URL,
      prefix: this.env.QUEUE_PREFIX,
      concurrency: this.env.WORKER_CONCURRENCY,
      timeoutSeconds: this.env.PROCESSING_TIMEOUT_SECONDS,
      log: this.log,
    });
    this.log.log(`Worker ready (concurrency ${this.env.WORKER_CONCURRENCY}). Waiting for documents.`);
  }

  async onApplicationShutdown() {
    await this.running?.close(); // lets a running job finish before the process exits
  }
}
