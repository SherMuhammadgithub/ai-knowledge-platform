import { Module } from "@nestjs/common";
import { ConfigModule } from "../config/config.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ProcessingModule } from "../processing/processing.module";
import { QueueModule } from "../queue/queue.module";
import { StorageModule } from "../storage/storage.module";
import { DocumentWorker } from "./document.worker";
import { SweeperService } from "./sweeper.service";
import { SystemQueries } from "./system-queries";

// The worker process: no HTTP server, no auth. It only reads jobs and processes documents.
@Module({
  imports: [ConfigModule, PrismaModule, StorageModule, QueueModule, ProcessingModule],
  providers: [DocumentWorker, SweeperService, SystemQueries],
})
export class WorkerModule {}
