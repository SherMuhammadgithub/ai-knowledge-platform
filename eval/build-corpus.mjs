// Builds the evaluation corpus from public GOV.UK guides.
// Run: bun run --cwd eval build-corpus
//
// Source: the GOV.UK content API (https://www.gov.uk/api/content/<slug>), which returns each guide with its parts and
// headings as HTML. Licence: Open Government Licence v3.0 (see eval/corpus/LICENSES.md). Only public text is fetched.
//
// What the conversion changes (also written to corpus/manifest.json, so nobody has to guess):
//  - HTML becomes plain text. The guide title, each part title and each section heading become lines of their own,
//    separated by blank lines. No markdown marks: real documents rarely have them.
//  - Links are removed and only their text is kept. Bullet items become lines that start with "- ".
//    Table rows become one line with the cells separated by " | ". Images and hidden accessibility text are dropped.
//  - Two lines are added at the end of each file: the source address and the licence attribution.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "corpus", "govuk");
const SLUGS = [
  "holiday-entitlement-rights",
  "statutory-sick-pay",
  "redundancy-your-rights",
  "maternity-pay-leave",
  "paternity-pay-leave",
  "flexible-working",
  "maximum-weekly-working-hours",
];
const LICENCE = "Open Government Licence v3.0";
const LICENCE_URL = "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/";
const ATTRIBUTION = "Contains public sector information licensed under the Open Government Licence v3.0.";

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", pound: "£", euro: "€", ndash: "-", mdash: "-", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", hellip: "..." };
const decode = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED[name.toLowerCase()] ?? m);

// Inline tags (links, emphasis) disappear without leaving a space, so "dispute</a>." stays "dispute.".
// Any other tag stands for a break between words.
const stripTags = (html) => html.replace(/<\/?(a|strong|em|b|i|span|abbr|sup|sub|small)\b[^>]*>/gi, "").replace(/<[^>]+>/g, " ");
const strip = (html) => decode(stripTags(html)).replace(/[ \t\u00A0]+/g, " ").trim();

/** GOV.UK part body (HTML) to plain text with headings on their own lines. */
function htmlToText(html) {
  let h = html
    .replace(/<\/li>\s+<li/gi, "</li><li") // items of one list stay on consecutive lines
    .replace(/<span[^>]*class="[^"]*visually-?hidden[^"]*"[^>]*>[\s\S]*?<\/span>/gi, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_, row) => {
      const cells = [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) => strip(m[1]));
      return `\n${cells.join(" | ")}\n`;
    })
    .replace(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/gi, (_, t) => `\n\n${strip(t)}\n\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `\n- ${strip(t)}`)
    .replace(/<\/(ul|ol)>/gi, "\n\n")
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => `\n\n${strip(t.replace(/<br\s*\/?>/gi, " "))}\n\n`)
    .replace(/<br\s*\/?>/gi, "\n");
  h = decode(stripTags(h));
  return h
    .split("\n")
    .map((line) => line.replace(/[ \t\u00A0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

mkdirSync(OUT, { recursive: true });
const manifest = [];
const fetchedOn = new Date().toISOString().slice(0, 10);

for (const slug of SLUGS) {
  const apiUrl = `https://www.gov.uk/api/content/${slug}`;
  const res = await fetch(apiUrl, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${apiUrl} answered ${res.status}`);
  const page = await res.json();
  const parts = page.details?.parts ?? [];
  if (parts.length === 0) throw new Error(`${slug} has no parts`);

  const blocks = [page.title.trim()];
  for (const part of parts) {
    blocks.push(part.title.trim());
    blocks.push(htmlToText(part.body ?? ""));
  }
  const url = `https://www.gov.uk/${slug}`;
  blocks.push(`Source: ${url}\n${ATTRIBUTION}`);
  const text = blocks.join("\n\n").replace(/\n{3,}/g, "\n\n") + "\n";

  const file = `govuk-${slug}.txt`;
  writeFileSync(join(OUT, file), text, "utf8");
  manifest.push({
    file: `govuk/${file}`,
    title: page.title.trim(),
    source: url,
    contentApi: apiUrl,
    fetchedOn,
    publishedUpdatedAt: page.public_updated_at?.slice(0, 10) ?? null,
    licence: LICENCE,
    licenceUrl: LICENCE_URL,
    attribution: ATTRIBUTION,
    parts: parts.length,
    characters: text.length,
    sha256: createHash("sha256").update(text).digest("hex"),
    changes: "HTML converted to plain text: headings kept as their own lines, links removed, bullet items as '- ' lines, table rows joined with ' | ', source and attribution lines added at the end.",
  });
  console.log(`${file.padEnd(48)} ${String(parts.length).padStart(2)} parts  ${String(text.length).padStart(6)} characters`);
}

writeFileSync(join(HERE, "corpus", "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(`\nWrote ${manifest.length} files to eval/corpus/govuk and eval/corpus/manifest.json`);
