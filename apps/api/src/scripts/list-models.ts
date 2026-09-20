// Lists the models your API key can actually call, straight from Google's API.
// Use this instead of trusting docs or memory when choosing model IDs.
// Run: bun run list:models   (from apps/api)

type ApiModel = {
  name: string;
  displayName?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
};

async function fetchAllModels(key: string): Promise<ApiModel[]> {
  const models: ApiModel[] = [];
  let pageToken = "";
  do {
    const url = new URL(
      "https://generativelanguage.googleapis.com/v1beta/models",
    );
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: { "x-goog-api-key": key } });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as {
      models?: ApiModel[];
      nextPageToken?: string;
    };
    models.push(...(body.models ?? []));
    pageToken = body.nextPageToken ?? "";
  } while (pageToken);
  return models;
}

async function main() {
  const key = process.env.GEMINI_API_KEY;
  if (!key)
    throw new Error(
      "GEMINI_API_KEY is empty. Put your key in .env at the project root.",
    );

  const models = await fetchAllModels(key);
  const show = (title: string, method: string) => {
    console.log(`\n== ${title} ==`);
    for (const m of models.filter((x) =>
      x.supportedGenerationMethods?.includes(method),
    )) {
      console.log(
        `${m.name.replace("models/", "").padEnd(42)} in:${String(m.inputTokenLimit ?? "?").padStart(8)} out:${String(m.outputTokenLimit ?? "?").padStart(6)}  ${m.displayName ?? ""}`,
      );
    }
  };
  show("generateContent (text generation)", "generateContent");
  show("embedContent (embeddings)", "embedContent");
  console.log(`\nTotal models visible: ${models.length}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
