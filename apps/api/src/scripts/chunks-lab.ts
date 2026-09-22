// Shows how the three chunking strategies cut a text file, and which lines are detected as headings.
// Works offline: no database, no Gemini, nothing is stored.
//
// Run: bun run --cwd apps/api chunks:lab ../../eval/corpus/govuk/govuk-flexible-working.txt
//        headings found, then chunk counts and sizes for fixed, paragraph and heading
//      bun run --cwd apps/api chunks:lab ../../eval/corpus/govuk/govuk-flexible-working.txt --show heading
//        also lists every chunk of that strategy (its heading, size, and the first words)
//      (--target 500 and --overlap 60 change the sizes, in tokens; the defaults are the project's)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHUNK_STRATEGIES, chunkPages, chunkSettingsFrom, estimateTokens, type ChunkStrategy } from "../chunking";
import { detectHeadings } from "../chunking/headings";

function main() {
  const argv = process.argv.slice(2);
  const option = (name: string) => {
    const at = argv.indexOf(name);
    return at === -1 ? undefined : argv[at + 1];
  };
  const file = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
  if (!file) throw new Error("Give a text file, for example: bun run --cwd apps/api chunks:lab ../../eval/corpus/govuk/govuk-flexible-working.txt");
  const show = option("--show") as ChunkStrategy | undefined;
  if (show && !CHUNK_STRATEGIES.includes(show)) throw new Error(`--show must be one of: ${CHUNK_STRATEGIES.join(", ")}`);

  const text = readFileSync(resolve(process.cwd(), file), "utf8").replace(/^\uFEFF/, "");
  const settings = chunkSettingsFrom({
    CHUNK_TARGET_TOKENS: Number(option("--target") ?? 500),
    CHUNK_OVERLAP_TOKENS: Number(option("--overlap") ?? 60),
  });
  const pages = [{ pageNumber: 1, text }];

  const headings = detectHeadings(text);
  console.log(`${file}: ${text.length} characters, about ${estimateTokens(text)} tokens\n`);
  console.log(`Headings detected (${headings.length}):`);
  for (const h of headings) console.log(`  at ${String(h.start).padStart(5)}  ${h.text}`);

  console.log("\nstrategy    chunks   average   smallest   largest   (tokens, estimated)");
  for (const strategy of CHUNK_STRATEGIES) {
    const chunks = chunkPages(pages, strategy, settings);
    const sizes = chunks.map((c) => c.tokenEstimate);
    const avg = Math.round(sizes.reduce((a, b) => a + b, 0) / Math.max(1, sizes.length));
    console.log(`${strategy.padEnd(10)} ${String(chunks.length).padStart(7)} ${String(avg).padStart(9)} ${String(Math.min(...sizes)).padStart(10)} ${String(Math.max(...sizes)).padStart(9)}`);
  }

  if (show) {
    console.log(`\nChunks of "${show}":`);
    for (const c of chunkPages(pages, show, settings)) {
      const start = c.text.replace(/\s+/g, " ").slice(0, 90);
      console.log(`\n  #${c.chunkIndex + 1}  ${c.tokenEstimate} tokens${c.heading ? `  heading: ${c.heading}` : ""}\n     ${start}${c.text.length > 90 ? "..." : ""}`);
    }
  }
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
