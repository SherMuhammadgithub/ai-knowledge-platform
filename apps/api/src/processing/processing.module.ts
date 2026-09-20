import { Module } from "@nestjs/common";
import { DocumentProcessorService } from "./document-processor.service";

@Module({
  providers: [DocumentProcessorService],
  exports: [DocumentProcessorService],
})
export class ProcessingModule {}
