import { Module } from "@nestjs/common";
import { EmbeddingModule } from "../embedding/embedding.module";
import { LlmModule } from "../llm/llm.module";
import { VectorModule } from "../vector/vector.module";
import { RagController } from "./rag.controller";
import { RagService } from "./rag.service";

@Module({
  imports: [EmbeddingModule, LlmModule, VectorModule],
  controllers: [RagController],
  providers: [RagService],
  exports: [RagService],
})
export class RagModule {}
