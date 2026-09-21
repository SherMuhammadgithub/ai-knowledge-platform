// Loads the evaluation corpus into its own workspace, through the normal upload pipeline.
// Run: bun run --cwd eval load-corpus     (the API and the worker must be running: bun run api, bun run worker)
//
// It uses a separate account (eval@akp.test) so the evaluation documents never mix with the demo data or your own.
// The uploaded text is public (Open Government Licence, see eval/corpus/LICENSES.md) and is sent to Gemini for
// embedding, like any upload. Safe to run again: files already in the workspace are skipped.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const API = process.env.API_URL ?? "http://localhost:3001";
const ACCOUNT = { email: "eval@akp.test", password: "eval-password-123", name: "GOV.UK corpus" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const manifest = JSON.parse(readFileSync(join(HERE, "corpus", "manifest.json"), "utf8"));

let cookie = "";
async function call(path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...(init.headers ?? {}), cookie } });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  return res;
}
const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// sign in, creating the account the first time
let res = await call("/auth/register", json(ACCOUNT));
if (res.status === 409) res = await call("/auth/login", json({ email: ACCOUNT.email, password: ACCOUNT.password }));
if (!res.ok) throw new Error(`Could not sign in as ${ACCOUNT.email}: ${res.status} ${await res.text()}`);
const me = await (await call("/auth/me")).json();
const workspaceName = me.workspaces?.find((w) => w.id === me.activeWorkspaceId)?.name ?? "(active workspace)";
console.log(`Signed in as ${ACCOUNT.email}, workspace "${workspaceName}"\n`);

// upload
for (const doc of manifest) {
  const form = new FormData();
  form.append("file", new Blob([readFileSync(join(HERE, "corpus", doc.file))], { type: "text/plain" }), doc.file.split("/").pop());
  const up = await call("/documents", { method: "POST", body: form });
  const note = up.status === 201 ? "uploaded" : up.status === 409 ? "already there" : `FAILED ${up.status} ${(await up.text()).slice(0, 120)}`;
  console.log(`${doc.file.split("/").pop().padEnd(46)} ${note}`);
}

// wait until every document is Ready (or Failed)
console.log("\nWaiting for the worker...");
const started = Date.now();
let last = "";
for (;;) {
  const docs = await (await call("/documents")).json();
  const line = docs.map((d) => `${d.name.replace(/^govuk-|\.txt$/g, "")}: ${d.status.toLowerCase()}${d.status === "INDEXING" && d.statusDetail ? ` (${d.statusDetail})` : ""}`).join("\n  ");
  if (line !== last) { console.log(`  ${line}\n`); last = line; }
  if (docs.every((d) => d.status === "READY" || d.status === "FAILED")) {
    const failed = docs.filter((d) => d.status === "FAILED");
    console.log(`Done in ${Math.round((Date.now() - started) / 1000)} s: ${docs.length - failed.length} ready, ${failed.length} failed.`);
    console.log(`Chunks: ${docs.reduce((n, d) => n + d.chunkCount, 0)}, embedded: ${docs.reduce((n, d) => n + d.embeddedCount, 0)}`);
    if (failed.length) { failed.forEach((d) => console.log(`  ${d.name}: ${d.statusDetail}`)); process.exit(1); }
    break;
  }
  if (Date.now() - started > 15 * 60_000) throw new Error("Gave up after 15 minutes. Is the worker running?");
  await sleep(3000);
}
