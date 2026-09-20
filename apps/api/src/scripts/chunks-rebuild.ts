// Cuts chunks for documents that are already Ready, from the pages stored in Postgres. It does not read the files again.
// Use it after the chunk table was added (documents processed before that have no chunks), or to switch strategy
// or sizes: change CHUNK_STRATEGY, CHUNK_TARGET_TOKENS or CHUNK_OVERLAP_TOKENS in .env, then run it.
//
// Run: bun run chunks:rebuild                       (the strategy from .env)
//      bun run chunks:rebuild -- --strategy fixed   (add or refresh one strategy, for comparison in Milestone 6)
//
// It only touches the chunks of the strategy it is rebuilding. Nothing is sent to any provider.
import { PrismaPg } from "@prisma/adapter-pg";
import { CHUNK_STRATEGIES, type ChunkStrategy, chunkPages, chunkSettingsFrom } from "../chunking";
import { replaceChunks } from "../chunking/save-chunks";
import { loadEnv } from "../config/env";
import { PrismaClient } from "../generated/prisma/client";
import { forWorkspace } from "../prisma/tenant-client";

function strategyFromArgs(fallback: ChunkStrategy): ChunkStrategy {
  const at = process.argv.indexOf("--strategy");
  if (at === -1) return fallback;
  const found = CHUNK_STRATEGIES.find((s) => s === process.argv[at + 1]);
  if (!found) throw new Error(`--strategy must be one of: ${CHUNK_STRATEGIES.join(", ")}`);
  return found;
}

async function main() {
  const env = loadEnv();
  const strategy = strategyFromArgs(env.CHUNK_STRATEGY);
  const settings = chunkSettingsFrom(env);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });

  try {
    // The one cross-workspace read: which documents to rebuild. Everything after it goes through the scoped client.
    const documents = await prisma.document.findMany({
      where: { status: "READY" },
      select: { id: true, workspaceId: true, originalName: true },
    });
    console.log(`Rebuilding "${strategy}" chunks (target ${env.CHUNK_TARGET_TOKENS} tokens, overlap ${env.CHUNK_OVERLAP_TOKENS}) for ${documents.length} documents.`);

    let total = 0;
    for (const doc of documents) {
      const db = forWorkspace(prisma, doc.workspaceId);
      const pages = await db.documentPage.findMany({
        where: { documentId: doc.id },
        select: { pageNumber: true, text: true },
      });
      const drafts = chunkPages(pages, strategy, settings);
      await db.transaction((tx) => replaceChunks(tx, doc.workspaceId, doc.id, drafts, strategy));
      total += drafts.length;
      console.log(`  ${String(drafts.length).padStart(4)} chunks  ${doc.originalName}`);
    }
    console.log(`Done: ${total} chunks.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
