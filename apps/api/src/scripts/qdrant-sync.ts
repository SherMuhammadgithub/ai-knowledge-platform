// Makes Qdrant match Postgres. Postgres is the source of truth, Qdrant is a search index that can always be rebuilt.
//
// For every workspace: writes a point for every embedded chunk of every Ready document (using the vectors already in
// Postgres, so it makes NO calls to Gemini and sends nothing anywhere), and removes points whose chunk no longer exists.
//
// Run: bun run --cwd apps/api qdrant:sync            fill and repair, then show the counts
//      bun run --cwd apps/api qdrant:sync --check    only compare and report, change nothing (exit code 1 if they differ)
//
// Use it once after adding Qdrant (documents that were Ready before have no points yet), after `chunks:rebuild`
// and `embed:backfill`, and any time the two might disagree, for example after Qdrant was down during a delete.
import { PrismaPg } from "@prisma/adapter-pg";
import { loadEnv } from "../config/env";
import { PrismaClient } from "../generated/prisma/client";
import { createProviders } from "../llm/providers";
import { forWorkspace } from "../prisma/tenant-client";
import { missingPointIds, stalePointIds } from "../vector/consistency";
import { VectorIndexService } from "../vector/vector-index.service";

async function main() {
  const checkOnly = process.argv.includes("--check");
  const env = loadEnv();
  const setupId = createProviders(env).embeddings.setupId; // only reads the setup, makes no call
  const strategy = env.CHUNK_STRATEGY;
  const index = new VectorIndexService(env);
  await index.ensureCollection();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });

  console.log(`Collection "${index.collection}", setup ${setupId}, strategy ${strategy}${checkOnly ? " (check only)" : ""}\n`);
  console.log("workspace".padEnd(34) + "ready docs".padStart(11) + "chunks with vector".padStart(20) + "points".padStart(8) + "  result");
  let problems = 0;

  try {
    // The one cross-workspace read: which workspaces and Ready documents exist. Everything after it is scoped.
    const workspaces = await prisma.workspace.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
    for (const ws of workspaces) {
      const db = forWorkspace(prisma, ws.id);
      const docs = await db.document.findMany({ where: { status: "READY" }, select: { id: true } });

      let removed = 0;
      let written = 0;
      if (!checkOnly) {
        for (const doc of docs) {
          const result = await index.syncDocument(db, doc.id, setupId, strategy);
          written += result.written;
        }
      }

      const pointIds = await index.listPointIds(ws.id);
      const knownChunkIds = (await db.documentChunk.findMany({ select: { id: true } })).map((c) => c.id);
      const stale = stalePointIds(pointIds, knownChunkIds);
      if (!checkOnly && stale.length) {
        await index.deletePoints(stale);
        removed = stale.length;
      }

      const embedded = (
        await db.documentChunk.findMany({
          where: { strategy, embeddedWith: setupId, document: { status: "READY" } },
          select: { id: true },
        })
      ).map((c) => c.id);
      const pointsNow = checkOnly ? pointIds : await index.listPointIds(ws.id);
      const missing = missingPointIds(embedded, pointsNow);
      const stayingStale = checkOnly ? stale.length : 0;
      const ok = missing.length === 0 && stayingStale === 0;
      if (!ok) problems++;

      const notes = [
        written ? `wrote ${written}` : "",
        removed ? `removed ${removed} stale` : "",
        missing.length ? `${missing.length} missing` : "",
        stayingStale ? `${stayingStale} stale` : "",
      ].filter(Boolean);
      if (docs.length || pointsNow.length) {
        console.log(ws.name.padEnd(34).slice(0, 34) + String(docs.length).padStart(11) + String(embedded.length).padStart(20) + String(pointsNow.length).padStart(8) + `  ${ok ? "in step" : "DIFFERS"}${notes.length ? `  (${notes.join(", ")})` : ""}`);
      }
    }
    console.log(problems === 0 ? "\nQdrant matches Postgres." : `\n${problems} workspace(s) differ.${checkOnly ? " Run without --check to fix." : ""}`);
    if (problems > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
