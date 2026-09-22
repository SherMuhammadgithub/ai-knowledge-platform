import { Inject, Injectable, Optional } from "@nestjs/common";
import type { WorkspaceAuth } from "../auth/auth.types";
import type { ChunkStrategy } from "../chunking";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { EMBEDDINGS } from "../embedding/embedding.tokens";
import { LLM } from "../llm/llm.tokens";
import type { EmbeddingClient, LlmClient } from "../llm/types";
import { TenantPrismaService } from "../prisma/tenant-prisma.service";
import { searchChunksWithIndex } from "../search/qdrant-search";
import { VectorIndexService } from "../vector/vector-index.service";
import { buildContext, buildUserPrompt, CONTEXT_TOKEN_BUDGET, MAX_OUTPUT_TOKENS, NOT_FOUND_ANSWER, RAG_TOP_K, REFUSAL_PHRASE, SYSTEM_PROMPT, TEMPERATURE } from "./prompt";

export type AnswerSource = {
  chunkId: string;
  documentId: string;
  documentName: string;
  pageNumber: number;
  chunkIndex: number;
  score: number;
};

export type AnswerUsage = {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  thoughtTokens: number | null;
  retrievalMs: number;
  generationMs: number;
};

export type AnswerResult = {
  answer: string;
  noAnswer: boolean;
  sources: AnswerSource[];
  usage: AnswerUsage;
};

/**
 * Question in, grounded answer out (Milestone 7). No citations formatting (Milestone 8), no conversation
 * history (Milestone 9): every call is answered alone, from this workspace's documents only.
 */
@Injectable()
export class RagService {
  private readonly strategy: ChunkStrategy;

  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly vectorIndex: VectorIndexService,
    @Inject(EMBEDDINGS) private readonly embeddings: EmbeddingClient,
    @Inject(LLM) private readonly llm: LlmClient,
    @Inject(ENV) env: Env,
    // Not DI-configured (it is a safety valve, not a setting; see prompt.ts). The parameter exists so a test
    // can build a RagService with a tiny budget directly and prove that a dropped hit is really dropped, both
    // from the prompt and from the returned sources, without needing an unrealistically large real document.
    @Optional() private readonly contextTokenBudget: number = CONTEXT_TOKEN_BUDGET,
  ) {
    this.strategy = env.CHUNK_STRATEGY;
  }

  async answer(actor: WorkspaceAuth, question: string): Promise<AnswerResult> {
    const db = this.tenant.for(actor);

    // Retrieval: embed the question and search Qdrant, filtered to this workspace by the scoped client, exactly
    // like the search script and the evaluation harness. No text is read outside what this call returns.
    const retrievalStarted = Date.now();
    const hits = await searchChunksWithIndex(db, this.vectorIndex, this.embeddings, this.strategy, question, RAG_TOP_K);
    const retrievalMs = Date.now() - retrievalStarted;

    // Nothing to read: skip the model call rather than pay for an answer whose content is already known.
    if (hits.length === 0) {
      return {
        answer: NOT_FOUND_ANSWER,
        noAnswer: true,
        sources: [],
        usage: { model: this.llm.model, inputTokens: null, outputTokens: null, thoughtTokens: null, retrievalMs, generationMs: 0 },
      };
    }

    const context = buildContext(hits, this.contextTokenBudget);

    const generationStarted = Date.now();
    const result = await this.llm.generate({
      system: SYSTEM_PROMPT,
      prompt: buildUserPrompt(question, context.text),
      temperature: TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      thinking: "minimal",
    });
    const generationMs = Date.now() - generationStarted;

    const answer = result.text.trim();
    return {
      answer,
      noAnswer: answer.startsWith(REFUSAL_PHRASE),
      // Only the chunks that were actually shown to the model, never the full retrieved list: a source is
      // never claimed unless the model really was given it (context.used can drop the lowest-scoring hits).
      sources: context.used.map((h) => ({
        chunkId: h.chunkId,
        documentId: h.documentId,
        documentName: h.documentName,
        pageNumber: h.pageNumber,
        chunkIndex: h.chunkIndex,
        score: h.score,
      })),
      usage: { model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, thoughtTokens: result.thoughtTokens, retrievalMs, generationMs },
    };
  }
}
