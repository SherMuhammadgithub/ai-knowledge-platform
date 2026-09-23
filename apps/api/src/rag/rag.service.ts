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
import { buildContext, buildUserPrompt, type Context, CONTEXT_TOKEN_BUDGET, MAX_OUTPUT_TOKENS, NOT_FOUND_ANSWER, RAG_TOP_K, REFUSAL_PHRASE, SYSTEM_PROMPT, TEMPERATURE } from "./prompt";

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
 * What `answerStream()` yields. `status` marks a real phase change the caller cannot otherwise see: real
 * generation calls have taken anywhere from a few seconds to over a minute in practice, and retrieval typically
 * finishes in under two seconds, so without this a UI has nothing to show for most of that wait except "still
 * searching", which is no longer true once generation has actually started.
 */
export type AnswerStreamEvent = { type: "status"; status: "retrieving" | "generating" } | { type: "delta"; text: string };

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
    const retrieved = await this.retrieve(actor, question);
    if (retrieved.context === null) return this.notFound(retrieved.retrievalMs);

    const generationStarted = Date.now();
    const result = await this.llm.generate({
      system: SYSTEM_PROMPT,
      prompt: buildUserPrompt(question, retrieved.context.text),
      temperature: TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      thinking: "minimal",
    });
    const generationMs = Date.now() - generationStarted;

    return this.toResult(result.text, retrieved.context, {
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      thoughtTokens: result.thoughtTokens,
      retrievalMs: retrieved.retrievalMs,
      generationMs,
    });
  }

  /**
   * Same as `answer()`, streamed: yields each piece of the answer as it arrives (or the whole refusal at once,
   * for the zero-hits case, so the caller never has to special-case it), then returns the same AnswerResult.
   */
  async *answerStream(actor: WorkspaceAuth, question: string): AsyncGenerator<AnswerStreamEvent, AnswerResult> {
    yield { type: "status", status: "retrieving" };
    const retrieved = await this.retrieve(actor, question);
    if (retrieved.context === null) {
      yield { type: "delta", text: NOT_FOUND_ANSWER };
      return this.notFound(retrieved.retrievalMs);
    }

    yield { type: "status", status: "generating" };
    const generationStarted = Date.now();
    const stream = this.llm.generateStream({
      system: SYSTEM_PROMPT,
      prompt: buildUserPrompt(question, retrieved.context.text),
      temperature: TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      thinking: "minimal",
    });
    let step = await stream.next();
    while (!step.done) {
      yield { type: "delta", text: step.value.text };
      step = await stream.next();
    }
    const result = step.value;
    const generationMs = Date.now() - generationStarted;

    return this.toResult(result.text, retrieved.context, {
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      thoughtTokens: result.thoughtTokens,
      retrievalMs: retrieved.retrievalMs,
      generationMs,
    });
  }

  /**
   * Retrieval, shared by `answer()` and `answerStream()`: embed the question and search Qdrant, filtered to
   * this workspace by the scoped client, exactly like the search script and the evaluation harness. No text is
   * read outside what this call returns. `context` is null when nothing was retrieved, the signal to skip the
   * model call rather than pay for an answer whose content is already known.
   */
  private async retrieve(actor: WorkspaceAuth, question: string): Promise<{ context: Context | null; retrievalMs: number }> {
    const db = this.tenant.for(actor);
    const retrievalStarted = Date.now();
    const hits = await searchChunksWithIndex(db, this.vectorIndex, this.embeddings, this.strategy, question, RAG_TOP_K);
    const retrievalMs = Date.now() - retrievalStarted;
    return { context: hits.length === 0 ? null : buildContext(hits, this.contextTokenBudget), retrievalMs };
  }

  private notFound(retrievalMs: number): AnswerResult {
    return {
      answer: NOT_FOUND_ANSWER,
      noAnswer: true,
      sources: [],
      usage: { model: this.llm.model, inputTokens: null, outputTokens: null, thoughtTokens: null, retrievalMs, generationMs: 0 },
    };
  }

  private toResult(text: string, context: Context, usage: AnswerUsage): AnswerResult {
    const answer = text.trim();
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
      usage,
    };
  }
}
