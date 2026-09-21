// Meaning search: type a question, see the chunks whose meaning is closest, with their scores.
// Since Milestone 6 the search goes through Qdrant. `--exact` uses the plain loop of Milestone 5 instead (every chunk
// vector of the workspace compared with the question's vector), and `--compare` runs both and says whether they agree.
//
// Run: bun run --cwd apps/api search
//        asks which workspace, then asks for questions until you press Enter on an empty line.
//      bun --env-file=../../.env run src/scripts/search.ts --workspace "Acme Corp" --k 3 "how many vacation days do I get?"
//        add --exact for the plain loop, or --compare to run both
//        one question in one go (run it from apps/api). On Windows, `bun run search <words with spaces>` breaks
//        because of how bun re-parses the command, so use the interactive form or this direct one.
//
// Each question you type is sent to Gemini (one embedding call). Chunk vectors are read from the database.
import { createInterface } from "node:readline";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadEnv } from "../config/env";
import { PrismaClient } from "../generated/prisma/client";
import { createProviders } from "../llm/providers";
import { forWorkspace } from "../prisma/tenant-client";
import { searchChunks } from "../search/plain-search";
import { searchChunksWithIndex } from "../search/qdrant-search";
import { VectorIndexService } from "../vector/vector-index.service";

function parseArgs(argv: string[]) {
  let workspace: string | undefined;
  let k = 5;
  let exact = false;
  let compare = false;
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--workspace") workspace = argv[++i];
    else if (argv[i] === "--k") k = Math.max(1, Number(argv[++i]) || 5);
    else if (argv[i] === "--exact") exact = true;
    else if (argv[i] === "--compare") compare = true;
    else words.push(argv[i]);
  }
  return { workspace, k, exact, compare, question: words.join(" ").trim() };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
  const rl = createInterface({ input: process.stdin });
  // Reads one line at a time. Works when you type and when input is piped in (a piped input ends at once).
  const lines = rl[Symbol.asyncIterator]();
  const prompt = async (text: string): Promise<string | undefined> => {
    process.stdout.write(text);
    const next = await lines.next();
    return next.done ? undefined : next.value.trim();
  };

  try {
    // Workspaces are not tenant data (they are the tenants), so the plain client may list them.
    const workspaces = await prisma.workspace.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });

    let chosen = args.workspace ? workspaces.filter((w) => w.name === args.workspace) : [];
    if (!args.workspace) {
      workspaces.forEach((w, i) => console.log(`  ${i + 1}. ${w.name}`));
      const answer = (await prompt("Which workspace? (number or name) ")) ?? "";
      chosen = workspaces.filter((w, i) => String(i + 1) === answer || w.name === answer);
    }
    if (chosen.length !== 1) {
      console.error(chosen.length === 0 ? "No such workspace." : "Several workspaces have that name. Use the number.");
      process.exit(1);
    }
    const workspace = chosen[0];

    const { embeddings } = createProviders(env);
    const index = new VectorIndexService(env);
    const db = forWorkspace(prisma, workspace.id);
    const searchable = await db.documentChunk.count({
      where: { strategy: env.CHUNK_STRATEGY, embeddedWith: embeddings.setupId, document: { status: "READY" } },
    });
    if (searchable === 0) {
      console.log("Nothing to search: this workspace has no embedded chunks yet. Run: bun run --cwd apps/api embed:backfill");
      return;
    }
    const points = await index.countForWorkspace(workspace.id, env.CHUNK_STRATEGY, embeddings.setupId);
    console.log(`\n"${workspace.name}" has ${searchable} searchable chunks and ${points} points in Qdrant (${embeddings.setupId}).`);
    if (points < searchable && !args.exact) {
      console.log("Some chunks are not in Qdrant yet. Run: bun run --cwd apps/api qdrant:sync");
    }

    const ask = async (question: string) => {
      const started = Date.now();
      const viaQdrant = () => searchChunksWithIndex(db, index, embeddings, env.CHUNK_STRATEGY, question, args.k);
      const viaLoop = () => searchChunks(db, embeddings, env.CHUNK_STRATEGY, question, args.k);
      const hits = args.exact ? await viaLoop() : await viaQdrant();
      console.log(`\nQuestion: ${question}   (${Date.now() - started} ms, ${args.exact ? "plain loop" : "Qdrant"})\n`);
      if (args.compare) {
        const other = args.exact ? await viaQdrant() : await viaLoop();
        const same = hits.length === other.length && hits.every((h, i) => h.chunkId === other[i].chunkId);
        console.log(same ? "Qdrant and the plain loop return the same chunks in the same order.\n" : "Qdrant and the plain loop DIFFER:\n" + other.map((h, i) => `   other ${i + 1}. ${h.score.toFixed(4)} ${h.documentName}, chunk ${h.chunkIndex + 1}`).join("\n") + "\n");
      }
      hits.forEach((hit, i) => {
        const text = hit.text.replace(/\s+/g, " ");
        console.log(`${i + 1}. score ${hit.score.toFixed(4)}   ${hit.documentName}, page ${hit.pageNumber}, chunk ${hit.chunkIndex + 1}`);
        console.log(`   ${text.length > 240 ? `${text.slice(0, 240)}...` : text}\n`);
      });
      console.log("Scores are relative: unrelated text still scores around 0.6, so read the gaps between them, not the numbers alone.\n");
    };

    if (args.question) {
      await ask(args.question);
      return;
    }
    for (;;) {
      const question = await prompt("Question (empty line to stop): ");
      if (!question) break;
      await ask(question);
    }
  } finally {
    rl.close();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
