// Makes documents that are already Ready searchable: creates vectors for their chunks.
// New uploads do this by themselves (the worker's embedding step). This is for documents that were read before
// embeddings existed, for example the demo data.
//
// IT SENDS TEXT TO GEMINI (the free tier may use what it receives), so by default it only handles the fictional
// sample documents: those whose name contains "(sample)". Every other document is listed by name as skipped.
//
// Run: bun run --cwd apps/api embed:backfill
//      bun run --cwd apps/api embed:backfill --include "facilities-guide.pdf"   (one more document, by exact name)
//      bun run --cwd apps/api embed:backfill --all                              (everything: only for public documents)
//
// Vectors already in the cache are reused, so running it again costs nothing.
import { PrismaPg } from "@prisma/adapter-pg";
import { loadEnv } from "../config/env";
import { ChunkEmbedder } from "../embedding/chunk-embedder";
import { PrismaClient } from "../generated/prisma/client";
import { createProviders } from "../llm/providers";
import { forWorkspace } from "../prisma/tenant-client";

const SAMPLE_MARK = "(sample)";

function argValues(flag: string): string[] {
  return process.argv.flatMap((arg, i) => (arg === flag && process.argv[i + 1] ? [process.argv[i + 1]] : []));
}

async function main() {
  const env = loadEnv();
  const { embeddings } = createProviders(env);
  const embedder = new ChunkEmbedder(embeddings, env.CHUNK_STRATEGY);
  const includeNames = new Set(argValues("--include"));
  const all = process.argv.includes("--all");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });

  try {
    // The one cross-workspace read: which documents to look at. Everything after it goes through the scoped client.
    const documents = await prisma.document.findMany({
      where: { status: { in: ["READY", "INDEXING"] } },
      select: { id: true, workspaceId: true, originalName: true, status: true },
      orderBy: { createdAt: "asc" },
    });

    console.log(`Embedding setup: ${embedder.setupId}`);
    let sent = 0;
    let calls = 0;
    let reused = 0;
    const skipped: string[] = [];

    for (const doc of documents) {
      if (doc.status === "INDEXING") {
        skipped.push(`${doc.originalName} (the worker is embedding it)`);
        continue;
      }
      const allowed = all || doc.originalName.includes(SAMPLE_MARK) || includeNames.has(doc.originalName);
      if (!allowed) {
        skipped.push(`${doc.originalName} (not a sample document)`);
        continue;
      }
      const db = forWorkspace(prisma, doc.workspaceId);
      const result = await embedder.embedDocument(db, doc.id);
      sent += result.newVectors;
      calls += result.calls;
      reused += result.reusedFromCache;
      console.log(
        `  ${doc.originalName}: ${result.total} chunks, ${result.alreadyEmbedded} already done, ${result.reusedFromCache} from the cache, ${result.newVectors} sent to Gemini`,
      );
    }

    console.log(`\nDone. ${sent} texts sent to Gemini in ${calls} call(s), ${reused} chunks served from the cache.`);
    if (skipped.length) {
      console.log(`\nSkipped ${skipped.length} document(s), nothing from them was sent:`);
      for (const line of skipped) console.log(`  ${line}`);
      console.log(`\nTo include one, run again with --include "<exact name>".`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
