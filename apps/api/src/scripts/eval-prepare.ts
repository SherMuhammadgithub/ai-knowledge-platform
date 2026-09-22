// Gets the evaluation workspace ready to be searched under one chunking strategy: cuts the chunks, gives them
// vectors, and puts them in Qdrant. Needed once per strategy before `eval:run --strategy <name>`.
//
// Run: bun run --cwd apps/api eval:prepare --strategy heading     (or fixed, or paragraph)
//      add --rebuild to cut the chunks again even if they exist (new chunk ids: earlier stored runs then point at
//      chunks that no longer exist, so only do this on purpose)
//
// It works ONLY in the workspace of eval@akp.test (the public GOV.UK guides from `bun run --cwd eval load-corpus`).
// There is deliberately no option for another workspace: this sends chunk text to Gemini for embedding, and other
// workspaces may hold private documents.
//
// What it does for each Ready document, using the workspace-scoped client:
//   1. if the document has no chunks for this strategy (or --rebuild): cut them from the stored pages (no provider call)
//   2. embed the chunks that have no vector yet. Text that was embedded before is reused from the cache (Gemini is
//      called only for new text, a few at a time, within the token limit)
//   3. write the points to Qdrant (and remove points of chunks that no longer exist, other strategies' points stay)
import { PrismaPg } from "@prisma/adapter-pg";
import { CHUNK_STRATEGIES, type ChunkStrategy, chunkPages, chunkSettingsFrom } from "../chunking";
import { replaceChunks } from "../chunking/save-chunks";
import { loadEnv } from "../config/env";
import { ChunkEmbedder } from "../embedding/chunk-embedder";
import { PrismaClient } from "../generated/prisma/client";
import { createProviders } from "../llm/providers";
import { forWorkspace } from "../prisma/tenant-client";
import { VectorIndexService } from "../vector/vector-index.service";

const EVAL_EMAIL = "eval@akp.test";

async function main() {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--strategy");
  const strategy = (at === -1 ? undefined : argv[at + 1]) as ChunkStrategy | undefined;
  if (!strategy || !CHUNK_STRATEGIES.includes(strategy)) throw new Error(`Give --strategy ${CHUNK_STRATEGIES.join(" | ")}`);
  const rebuild = argv.includes("--rebuild");
  const unknown = argv.filter((a) => a.startsWith("--") && !["--strategy", "--rebuild"].includes(a));
  if (unknown.length) throw new Error(`Unknown option: ${unknown.join(", ")}`);

  const env = loadEnv();
  const settings = chunkSettingsFrom(env);
  const { embeddings } = createProviders(env);
  const index = new VectorIndexService(env);
  await index.ensureCollection();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });

  try {
    // Users, memberships and workspaces are not tenant data, so the plain client may look up the workspace.
    const memberships = await prisma.membership.findMany({ where: { user: { email: EVAL_EMAIL } }, select: { workspace: { select: { id: true, name: true } } } });
    const workspaces = [...new Map(memberships.map((m) => [m.workspace.id, m.workspace])).values()];
    if (workspaces.length !== 1) throw new Error(`Expected one workspace for ${EVAL_EMAIL}, found ${workspaces.length}. Load the corpus first: bun run --cwd eval load-corpus`);
    const workspace = workspaces[0];
    const db = forWorkspace(prisma, workspace.id);

    const docs = await db.document.findMany({ where: { status: "READY" }, select: { id: true, originalName: true }, orderBy: { originalName: "asc" } });
    console.log(`Workspace "${workspace.name}": ${docs.length} Ready documents. Strategy "${strategy}" (target ${env.CHUNK_TARGET_TOKENS} tokens, overlap ${env.CHUNK_OVERLAP_TOKENS}), embedding setup ${embeddings.setupId}.\n`);

    const embedder = new ChunkEmbedder(embeddings, strategy);
    const started = Date.now();
    let cut = 0;
    let totals = { chunks: 0, cache: 0, fresh: 0, calls: 0, points: 0 };
    for (const doc of docs) {
      const existing = await db.documentChunk.count({ where: { documentId: doc.id, strategy } });
      let note = "kept chunks";
      if (existing === 0 || rebuild) {
        const pages = await db.documentPage.findMany({ where: { documentId: doc.id }, select: { pageNumber: true, text: true } });
        const drafts = chunkPages(pages, strategy, settings);
        await db.transaction((tx) => replaceChunks(tx, workspace.id, doc.id, drafts, strategy));
        note = `cut ${drafts.length} chunks`;
        cut++;
      }
      const result = await embedder.embedDocument(db, doc.id);
      const synced = await index.syncDocument(db, doc.id, embeddings.setupId, strategy);
      totals = { chunks: totals.chunks + result.total, cache: totals.cache + result.reusedFromCache, fresh: totals.fresh + result.newVectors, calls: totals.calls + result.calls, points: totals.points + synced.written };
      console.log(`  ${doc.originalName.replace(/^govuk-|\.txt$/g, "").padEnd(32)} ${note.padEnd(16)} ${String(result.total).padStart(2)} chunks: ${result.alreadyEmbedded} had vectors, ${result.reusedFromCache} from cache, ${result.newVectors} new (${result.calls} Gemini calls)`);
    }
    console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)} s: ${totals.chunks} chunks, ${totals.fresh} new vectors from ${totals.calls} Gemini calls, ${totals.cache} reused from the cache, ${totals.points} points written to Qdrant. Documents cut: ${cut}.`);
    console.log(`Next: bun run --cwd apps/api eval:run --strategy ${strategy} --label <name>`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
