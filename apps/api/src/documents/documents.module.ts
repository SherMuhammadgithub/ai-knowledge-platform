import { Module } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { QueueModule } from "../queue/queue.module";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";

@Module({
  imports: [
    QueueModule,
    MulterModule.registerAsync({
      inject: [ENV],
      // Memory storage, capped. The upload library rejects a bigger file with 413 while it is still arriving.
      useFactory: (env: Env) => ({ limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 } }),
    }),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}
