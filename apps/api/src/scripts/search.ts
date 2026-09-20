// The plain search of Milestone 5: type a question, see the chunks whose meaning is closest, with their scores.
// This is the proof that embeddings work on your own documents. There is no index and no reranking: every chunk
// vector of the workspace is compared with the question's vector. Milestone 6 swaps this loop for Qdrant.
//
// Run: bun run --cwd apps/api search
//        asks which workspace, then asks for questions until you press Enter on an empty line.
//      bun --env-file=../../.env run src/scripts/search.ts --workspace "Acme Corp" --k 3 "how many vacation days do I get?"
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

function parseArgs(argv: string[]) {
  let workspace: string | undefined;
  let k = 5;
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--workspace") workspace = argv[++i];
    else if (argv[i] === "--k") k = Math.max(1, Number(argv[++i]) || 5);
    else words.push(argv[i]);
  }
  return { workspace, k, question: words.join(" ").trim() };
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
    const db = forWorkspace(prisma, workspace.id);
    const searchable = await db.documentChunk.count({
      where: { strategy: env.CHUNK_STRATEGY, embeddedWith: embeddings.setupId, document: { status: "READY" } },
    });
    if (searchable === 0) {
      console.log("Nothing to search: this workspace has no embedded chunks yet. Run: bun run --cwd apps/api embed:backfill");
      return;
    }
    console.log(`\n"${workspace.name}" has ${searchable} searchable chunks (${embeddings.setupId}).`);

    const ask = async (question: string) => {
      const started = Date.now();
      const hits = await searchChunks(db, embeddings, env.CHUNK_STRATEGY, question, args.k);
      console.log(`\nQuestion: ${question}   (${Date.now() - started} ms)\n`);
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
