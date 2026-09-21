// The evaluation harness. Runs the reviewed questions through search and scores the results.
//
//   bun run --cwd apps/api eval:check      only checks that every expected quote is really in its document.
//                                          Makes no call to Gemini and stores nothing.
//   bun run --cwd apps/api eval:run        runs the questions marked "keep", prints the scores, stores the run in
//                                          the database and as a JSON file in eval/runs/. One batch call to Gemini
//                                          embeds the questions (public text only: the GOV.UK questions).
//
// Options (put them after the script name, no spaces inside a value):
//   --strategy paragraph|fixed    which chunks to search (default: CHUNK_STRATEGY from .env)
//   --label baseline              a short name kept with the stored run
//   --questions <path>            question file (default: eval/questions/govuk.json)
//   --workspace <name>            default: the workspace of eval@akp.test, where load-corpus put the GOV.UK guides
//   --exact                       ask Qdrant for an exact search
//   --include-candidates          also run questions still marked "candidate". Prints only, never stores.
//   --no-store                    print only
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { CHUNK_STRATEGIES, type ChunkStrategy } from "../chunking";
import { loadEnv } from "../config/env";
import { checkQuotes, EvalSetupError, runEvaluation, saveRun, writeRunFile, type EvalReport } from "../evaluation/runner";
import { loadQuestionFile } from "../evaluation/questions";
import { PrismaClient } from "../generated/prisma/client";
import { createProviders } from "../llm/providers";
import { forWorkspace } from "../prisma/tenant-client";
import { VectorIndexService } from "../vector/vector-index.service";

const EVAL_EMAIL = "eval@akp.test";

function parseArgs(argv: string[]) {
  const args = { check: false, exact: false, includeCandidates: false, noStore: false } as {
    check: boolean; exact: boolean; includeCandidates: boolean; noStore: boolean;
    strategy?: string; label?: string; questions?: string; workspace?: string;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") args.check = true;
    else if (a === "--exact") args.exact = true;
    else if (a === "--include-candidates") args.includeCandidates = true;
    else if (a === "--no-store") args.noStore = true;
    else if (a === "--strategy") args.strategy = argv[++i];
    else if (a === "--label") args.label = argv[++i];
    else if (a === "--questions") args.questions = argv[++i];
    else if (a === "--workspace") args.workspace = argv[++i];
    else throw new Error(`Unknown option: ${a}`);
  }
  return args;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const range = (r: { min: number; median: number; max: number } | null) => (r ? `${r.min.toFixed(3)} to ${r.max.toFixed(3)}, median ${r.median.toFixed(3)}` : "none");
const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 3)}...` : text);
const shortDoc = (name: string) => name.replace(/^govuk-|\.txt$/g, "");

function printReport(report: EvalReport) {
  const m = report.metrics;
  console.log(`\nStrategy ${report.strategy}, ${report.retrieval}, top ${report.k}. Chunks: ${report.chunks.count} (average ${report.chunks.avgTokens} tokens, largest ${report.chunks.maxTokens}).`);
  console.log(`Questions run: ${report.questionSet.ran} of ${report.questionSet.inFile} in the file (${report.questionSet.skipped.candidate} still candidates, ${report.questionSet.skipped.drop} dropped).\n`);

  for (const r of report.results) {
    const first = r.retrieved[0];
    let line: string;
    if (!r.answerable) line = `n/a   top score ${r.topScore?.toFixed(3) ?? "-"} (${first ? `${shortDoc(first.documentName)}, chunk ${first.chunkIndex + 1}` : "nothing"})`;
    else if (r.rank) line = `hit @${r.rank}  score ${r.retrieved[r.rank - 1].score.toFixed(3)}`;
    else line = `MISS  top was ${first ? `${shortDoc(first.documentName)}, chunk ${first.chunkIndex + 1} (${first.score.toFixed(3)})` : "nothing"}${r.reachable ? "" : "   [chunking cut through the answer]"}`;
    console.log(`${r.id.padEnd(5)} ${line.padEnd(58)} ${clip(r.question, 70)}`);
  }

  console.log(`\nAnswerable questions: ${m.answerable}. Unanswerable: ${m.unanswerable} (not scored).`);
  console.log(`  hit rate @1  ${pct(m.hitRate[1])}`);
  console.log(`  hit rate @3  ${pct(m.hitRate[3])}`);
  console.log(`  hit rate @5  ${pct(m.hitRate[5])}`);
  console.log(`  MRR          ${m.mrr.toFixed(3)}`);
  if (m.unreachable) console.log(`  ${m.unreachable} answerable question(s) cannot be answered by any single chunk: chunking cut through the expected quote. They count as misses.`);
  console.log(`  top score when the documents can answer:     ${range(m.topScoreWhenAnswerable)}`);
  console.log(`  top score when the documents cannot answer:  ${range(m.topScoreWhenUnanswerable)}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const strategy = (args.strategy ?? env.CHUNK_STRATEGY) as ChunkStrategy;
  if (!CHUNK_STRATEGIES.includes(strategy)) throw new Error(`--strategy must be one of: ${CHUNK_STRATEGIES.join(", ")}`);
  const file = loadQuestionFile(resolve(process.cwd(), args.questions ?? "../../eval/questions/govuk.json"));

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
  try {
    // Users, memberships and workspaces are not tenant data, so the plain client may look up the workspace.
    const memberships = await prisma.membership.findMany({
      where: args.workspace ? { workspace: { name: args.workspace } } : { user: { email: EVAL_EMAIL } },
      select: { workspace: { select: { id: true, name: true } } },
    });
    const workspaces = [...new Map(memberships.map((m) => [m.workspace.id, m.workspace])).values()];
    if (workspaces.length !== 1) {
      throw new Error(
        workspaces.length === 0
          ? `No workspace found${args.workspace ? ` named "${args.workspace}"` : ` for ${EVAL_EMAIL}. Load the corpus first: bun run --cwd eval load-corpus`}.`
          : "Several workspaces match. Give a more exact --workspace name.",
      );
    }
    const workspace = workspaces[0];
    const db = forWorkspace(prisma, workspace.id);

    const counts = (status: string) => file.questions.filter((q) => q.status === status).length;
    console.log(`Question set "${file.name}": ${file.questions.length} questions (${counts("keep")} keep, ${counts("candidate")} candidate, ${counts("drop")} drop). Workspace "${workspace.name}".`);

    if (args.check) {
      const chunkCount = await db.documentChunk.count({ where: { strategy, document: { status: "READY" } } });
      if (chunkCount === 0) throw new Error(`This workspace has no "${strategy}" chunks yet, so quotes cannot be checked against them. Try: bun run --cwd apps/api chunks:rebuild`);
      const checks = await checkQuotes(db, strategy, file.questions.filter((q) => q.status !== "drop"));
      const problems = checks.filter((c) => c.state !== "ok");
      for (const c of problems) {
        const what = { "no-such-document": `no document named ${c.document} in this workspace`, "not-in-document": `this quote is not in ${c.document}`, "split-across-chunks": `${c.document}: the quote is in the text but no single "${strategy}" chunk holds it`, ok: "" }[c.state];
        console.log(`  ${c.questionId}: ${what}\n        "${clip(c.quote, 90)}"`);
      }
      console.log(`\n${checks.length} expected quotes checked (drops skipped): ${checks.length - problems.length} found in a chunk, ${problems.length} with a problem.`);
      const asked = file.questions.filter((q) => q.status !== "drop");
      const noAnswers = asked.filter((q) => q.answerable).length;
      console.log(`${noAnswers} answerable and ${asked.length - noAnswers} unanswerable questions in scope.`);
      if (problems.some((c) => c.state !== "split-across-chunks")) process.exit(1);
      return;
    }

    const { embeddings } = createProviders(env);
    const index = new VectorIndexService(env);
    const report = await runEvaluation({ db, index, embeddings }, file, {
      strategy,
      label: args.label,
      exact: args.exact,
      includeUnreviewed: args.includeCandidates,
      chunkSettings: { targetTokens: env.CHUNK_TARGET_TOKENS, overlapTokens: env.CHUNK_OVERLAP_TOKENS },
    });
    printReport(report);

    if (args.includeCandidates || args.noStore) {
      console.log(`\nNot stored (${args.includeCandidates ? "runs that include candidates are for looking at only" : "--no-store"}).`);
      return;
    }
    const id = await saveRun(db, report);
    const path = writeRunFile(resolve(process.cwd(), "../../eval/runs"), id, report);
    console.log(`\nStored: database row ${id}\n        ${path}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof EvalSetupError ? err.message : err instanceof Error ? err.message : err);
  process.exit(1);
});
