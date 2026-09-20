import { Module } from "@nestjs/common";
import { DocumentQueueService } from "./document-queue.service";

@Module({
  providers: [DocumentQueueService],
  exports: [DocumentQueueService],
})
export class QueueModule {}
