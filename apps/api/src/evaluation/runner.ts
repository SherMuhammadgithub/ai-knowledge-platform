import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ChunkStrategy } from "../chunking";
import type { Prisma } from "../generated/prisma/client";
import type { EmbeddingClient } from "../llm/types";
import type { TenantDb } from "../prisma/tenant-client";
import { searchChunksByVector } from "../search/qdrant-search";
import type { VectorIndexService } from "../vector/vector-index.service";
import { EVAL_K, firstHitRank, summarize, type QuestionResult, type RunMetrics } from "./metrics";
import { containsQuote, isHit, normalizeText, type EvalQuestion, type QuestionFile } from "./questions";

/**
 * The evaluation harness (Milestone 6).
 *
 *   questions -> one batch call to embed them -> for each: Qdrant search (top 5, this workspace, this strategy)
 *             -> was a correct chunk among them, and at which rank? -> hit rate at 1, 3 and 5, and MRR
 *
 * Retrieval goes through exactly the code the product uses (`searchChunksByVector`), so the numbers describe the
 * real search, not a copy of it.
 */

export type QuoteState =
  | "ok" // some chunk contains the quote
  | "no-such-document" // the question names a document this workspace does not have (a mistake in the question file)
  | "not-in-document" // the document does not contain the quote (a typo, or the text was cleaned differently)
  | "split-across-chunks"; // the document contains the quote but no single chunk does: chunking cut through the answer

export type QuoteCheck = { questionId: string; document: string; quote: string; state: QuoteState };

/** Looks for each expected quote in the document's text and in its chunks. Makes no provider call. */
export async function checkQuotes(db: TenantDb, strategy: ChunkStrategy, questions: EvalQuestion[]): Promise<QuoteCheck[]> {
  const documents = await db.document.findMany({ where: { status: "READY" }, select: { id: true, originalName: true } });
  const idsByName = new Map<string, string[]>();
  for (const d of documents) idsByName.set(d.originalName, [...(idsByName.get(d.originalName) ?? []), d.id]);

  const ids = documents.map((d) => d.id);
  const pages = await db.documentPage.findMany({ where: { documentId: { in: ids } }, select: { documentId: true, text: true } });
  const chunks = await db.documentChunk.findMany({ where: { strategy, documentId: { in: ids } }, select: { documentId: true, text: true } });
  const pageText = (documentIds: string[]) => pages.filter((p) => documentIds.includes(p.documentId)).map((p) => p.text);
  const chunkText = (documentIds: string[]) => chunks.filter((c) => documentIds.includes(c.documentId)).map((c) => c.text);

  return questions.flatMap((q) =>
    q.answers.map((a): QuoteCheck => {
      const documentIds = idsByName.get(a.document);
      let state: QuoteState;
      if (!documentIds) state = "no-such-document";
      else if (chunkText(documentIds).some((t) => containsQuote(t, a.quote))) state = "ok";
      else if (pageText(documentIds).some((t) => containsQuote(t, a.quote))) state = "split-across-chunks";
      else state = "not-in-document";
      return { questionId: q.id, document: a.document, quote: a.quote, state };
    }),
  );
}

export class EvalSetupError extends Error {}

export type EvalReport = {
  label: string | null;
  ranAt: string;
  strategy: ChunkStrategy;
  retrieval: "qdrant" | "qdrant-exact";
  k: number;
  embedding: { model: string; dimensions: number; setupId: string };
  questionSet: {
    name: string;
    file: string;
    sha256: string;
    inFile: number;
    ran: number;
    skipped: { candidate: number; drop: number };
  };
  chunks: { configuredTargetTokens: number; configuredOverlapTokens: number; count: number; avgTokens: number; minTokens: number; maxTokens: number };
  corpus: { document: string; contentHash: string; chunkCount: number }[];
  quoteProblems: QuoteCheck[];
  metrics: RunMetrics;
  results: QuestionResult[];
};

export type RunOptions = {
  strategy: ChunkStrategy;
  label?: string | null;
  /** Ask Qdrant for an exact search instead of its approximate one. */
  exact?: boolean;
  /** Also run questions that are still "candidate". The result is for looking at, never stored. */
  includeUnreviewed?: boolean;
  chunkSettings: { targetTokens: number; overlapTokens: number };
};

export async function runEvaluation(
  deps: { db: TenantDb; index: VectorIndexService; embeddings: EmbeddingClient },
  file: QuestionFile,
  options: RunOptions,
): Promise<EvalReport> {
  const { db, index, embeddings } = deps;
  const { strategy } = options;

  const toRun = file.questions.filter((q) => q.status === "keep" || (options.includeUnreviewed && q.status === "candidate"));
  if (toRun.length === 0) {
    throw new EvalSetupError('No question has status "keep". Review the question file first (change "candidate" to "keep" or "drop").');
  }

  // 1. The index must hold every chunk of this strategy, or the numbers describe a half-built index.
  const chunkFilter = { strategy, embeddedWith: embeddings.setupId, document: { status: "READY" as const } };
  const searchable = await db.documentChunk.count({ where: chunkFilter });
  const allChunks = await db.documentChunk.count({ where: { strategy, document: { status: "READY" } } });
  if (searchable === 0) throw new EvalSetupError(`No searchable "${strategy}" chunks in this workspace (embedded with ${embeddings.setupId}). Upload and embed the documents first.`);
  if (searchable < allChunks) throw new EvalSetupError(`${allChunks - searchable} of ${allChunks} "${strategy}" chunks have no vector under the current embedding setup. Run embed:backfill first.`);
  const points = await index.countForWorkspace(db.workspaceId, strategy, embeddings.setupId);
  if (points !== searchable) throw new EvalSetupError(`Qdrant holds ${points} points but Postgres has ${searchable} chunks with vectors. Run qdrant:sync first.`);

  // 2. Every expected quote must exist in its document, or the question file has a mistake.
  const checks = await checkQuotes(db, strategy, toRun);
  const mistakes = checks.filter((c) => c.state === "no-such-document" || c.state === "not-in-document");
  if (mistakes.length) {
    const lines = mistakes.map((c) => `  ${c.questionId}: ${c.state === "no-such-document" ? `no document named "${c.document}"` : `"${c.quote}" is not in ${c.document}`}`);
    throw new EvalSetupError(`The question file has mistakes:\n${lines.join("\n")}`);
  }
  const stateOf = (q: EvalQuestion) => checks.filter((c) => c.questionId === q.id);

  // 3. One batch call for every question, then one search per question.
  const vectors = await embeddings.embed(toRun.map((q) => q.question), "query");
  const results: QuestionResult[] = [];
  for (const [i, q] of toRun.entries()) {
    const hits = await searchChunksByVector(db, index, embeddings.setupId, strategy, vectors[i], EVAL_K, { exact: options.exact });
    const retrieved = hits.map((h, j) => ({
      rank: j + 1,
      score: h.score,
      chunkId: h.chunkId,
      documentName: h.documentName,
      chunkIndex: h.chunkIndex,
      hit: q.answerable && isHit(q, h),
      preview: normalizeText(h.text).slice(0, 160),
    }));
    results.push({
      id: q.id,
      question: q.question,
      kind: q.kind,
      answerable: q.answerable,
      rank: q.answerable ? firstHitRank(retrieved) : null,
      topScore: retrieved[0]?.score ?? null,
      reachable: !q.answerable || stateOf(q).some((c) => c.state === "ok"),
      retrieved,
    });
  }

  // 4. What was searched, so a stored run can be understood later.
  const stats = await db.documentChunk.aggregate({
    where: { strategy, document: { status: "READY" } },
    _count: true,
    _avg: { tokenEstimate: true },
    _min: { tokenEstimate: true },
    _max: { tokenEstimate: true },
  });
  const documents = await db.document.findMany({
    where: { status: "READY" },
    select: { originalName: true, contentHash: true, _count: { select: { chunks: { where: { strategy } } } } },
    orderBy: { originalName: "asc" },
  });

  return {
    label: options.label ?? null,
    ranAt: new Date().toISOString(),
    strategy,
    retrieval: options.exact ? "qdrant-exact" : "qdrant",
    k: EVAL_K,
    embedding: { model: embeddings.model, dimensions: embeddings.dimensions, setupId: embeddings.setupId },
    questionSet: {
      name: file.name,
      file: basename(file.path),
      sha256: file.sha256,
      inFile: file.questions.length,
      ran: toRun.length,
      skipped: {
        candidate: options.includeUnreviewed ? 0 : file.questions.filter((q) => q.status === "candidate").length,
        drop: file.questions.filter((q) => q.status === "drop").length,
      },
    },
    chunks: {
      configuredTargetTokens: options.chunkSettings.targetTokens,
      configuredOverlapTokens: options.chunkSettings.overlapTokens,
      count: stats._count,
      avgTokens: Math.round(stats._avg.tokenEstimate ?? 0),
      minTokens: stats._min.tokenEstimate ?? 0,
      maxTokens: stats._max.tokenEstimate ?? 0,
    },
    corpus: documents.map((d) => ({ document: d.originalName, contentHash: d.contentHash, chunkCount: d._count.chunks })),
    quoteProblems: checks.filter((c) => c.state !== "ok"),
    metrics: summarize(results),
    results,
  };
}

/** Stores a run in the database (tenant table). Returns its id. */
export async function saveRun(db: TenantDb, report: EvalReport): Promise<string> {
  const { metrics } = report;
  const row = await db.evalRun.create({
    data: {
      // Required by the types. The scoped client overwrites it with its own workspace anyway.
      workspaceId: db.workspaceId,
      label: report.label,
      strategy: report.strategy,
      setupId: report.embedding.setupId,
      retrieval: report.retrieval,
      k: report.k,
      questionSet: report.questionSet.name,
      questionFileHash: report.questionSet.sha256,
      questionCount: report.questionSet.ran,
      answerableCount: metrics.answerable,
      hitRate1: metrics.hitRate[1],
      hitRate3: metrics.hitRate[3],
      hitRate5: metrics.hitRate[5],
      mrr: metrics.mrr,
      config: {
        ranAt: report.ranAt,
        embedding: report.embedding,
        chunks: report.chunks,
        corpus: report.corpus,
        questionSet: report.questionSet,
        quoteProblems: report.quoteProblems,
        unreachable: metrics.unreachable,
        unanswerable: metrics.unanswerable,
        topScoreWhenAnswerable: metrics.topScoreWhenAnswerable,
        topScoreWhenUnanswerable: metrics.topScoreWhenUnanswerable,
      } as unknown as Prisma.InputJsonValue,
      results: report.results as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return row.id;
}

/** Writes the same run as a JSON file, named by time, strategy and label. Returns the path. */
export function writeRunFile(dir: string, runId: string, report: EvalReport): string {
  mkdirSync(dir, { recursive: true });
  const stamp = report.ranAt.replace(/:/g, "-").replace(/\..*$/, "");
  const label = report.label ? `-${report.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}` : "";
  const path = join(dir, `${stamp}-${report.strategy}${label}.json`);
  writeFileSync(path, JSON.stringify({ runId, ...report }, null, 2) + "\n", "utf8");
  return path;
}

