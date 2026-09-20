import { Module } from "@nestjs/common";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { createProviders } from "../llm/providers";
import { DocumentIndexerService } from "./document-indexer.service";
import { EMBEDDINGS } from "./embedding.tokens";

@Module({
  providers: [
    // The one place the embedding provider is chosen for the running app (see llm/providers.ts).
    { provide: EMBEDDINGS, inject: [ENV], useFactory: (env: Env) => createProviders(env).embeddings },
    DocumentIndexerService,
  ],
  exports: [EMBEDDINGS, DocumentIndexerService],
})
export class EmbeddingModule {}
