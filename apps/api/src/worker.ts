import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { loadEnv } from "./config/env";
import { WorkerModule } from "./worker/worker.module";

// Entry point of the processing worker. A second process from the same codebase: `bun run worker`.
async function bootstrap() {
  loadEnv(); // fail fast on a bad .env
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks(); // Ctrl+C lets the running job finish first
  new Logger("Worker").log("Processing worker started");
}

void bootstrap();
