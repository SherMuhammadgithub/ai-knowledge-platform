import { Module } from "@nestjs/common";
import { QueueModule } from "../queue/queue.module";
import { DocumentProcessorService } from "./document-processor.service";

@Module({
  imports: [QueueModule],
  providers: [DocumentProcessorService],
  exports: [DocumentProcessorService],
})
export class ProcessingModule {}
