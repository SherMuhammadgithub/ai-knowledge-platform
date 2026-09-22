import { Module } from "@nestjs/common";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { createProviders } from "./providers";
import { LLM } from "./llm.tokens";

@Module({
  // The one place the generation provider is chosen for the running app (see providers.ts). Mirrors EmbeddingModule.
  providers: [{ provide: LLM, inject: [ENV], useFactory: (env: Env) => createProviders(env).llm }],
  exports: [LLM],
})
export class LlmModule {}
