// End-to-end check of the provider layer: one generation call, one embedding call, one similarity check.
// Run: bun run smoke:gemini   (needs a filled-in .env)
import { loadEnv } from "../config/env";
import { createProviders } from "../llm/providers";

const cosine = (a: number[], b: number[]) => {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] ** 2;
    nb += b[i] ** 2;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
};

async function main() {
  const env = loadEnv();
  const { llm, embeddings } = createProviders(env);

  console.log(`generation model: ${llm.model}`);
  console.log(
    `embedding model:  ${embeddings.model} (${embeddings.dimensions} dims)\n`,
  );

  const gen = await llm.generate({
    prompt: "In one short sentence, what is a vector embedding?",
    temperature: 0,
    maxOutputTokens: 100,
  });
  console.log(`generate -> ${gen.text.trim()}\n`);

  // Two texts and one query. The related text should score clearly higher.
  const docs = await embeddings.embed(
    [
      "Employees get 25 days of paid annual leave.",
      "The office kitchen has a coffee machine.",
    ],
    "document",
  );
  const [query] = await embeddings.embed(
    ["How many vacation days do I get?"],
    "query",
  );
  // Regression check: a batch must return one distinct vector per text, never one merged vector.
  if (docs.length !== 2 || cosine(docs[0], docs[1]) > 0.999) {
    throw new Error("Batch embedding returned merged or duplicate vectors.");
  }
  const sLeave = cosine(query, docs[0]);
  const sCoffee = cosine(query, docs[1]);
  console.log(`cosine(query, leave doc)  = ${sLeave.toFixed(4)}`);
  console.log(`cosine(query, coffee doc) = ${sCoffee.toFixed(4)}`);
  console.log(
    sLeave > sCoffee
      ? "\nOK: related text scores higher."
      : "\nWARNING: ranking looks wrong, investigate.",
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
