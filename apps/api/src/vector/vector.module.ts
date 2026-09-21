import { Module } from "@nestjs/common";
import { VectorIndexService } from "./vector-index.service";

@Module({
  providers: [VectorIndexService],
  exports: [VectorIndexService],
})
export class VectorModule {}
