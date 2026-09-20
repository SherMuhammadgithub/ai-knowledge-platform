// Reads the design tokens from src/app/globals.css and checks WCAG contrast for the text pairs we use.
// Run: bun run check:contrast   Exit code 1 if any pair fails.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("../src/app/globals.css", import.meta.url)), "utf8");

// Pull "--name: oklch(L C H);" pairs out of one block (":root {" or ".dark {").
function tokens(blockStart) {
  const start = css.indexOf(blockStart);
  const end = css.indexOf("\n}", start);
  const out = {};
  for (const m of css.slice(start, end).matchAll(/--([\w-]+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/g)) {
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return out;
}

const gamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const linear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function relativeLuminance([L, C, h]) {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => linear(Math.min(1, Math.max(0, gamma(c)))));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

const ratio = (a, b) => {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [foreground token, background token]
const PAIRS = [
  ["foreground", "background"],
  ["sidebar-foreground", "sidebar"],
  ["sidebar-accent-foreground", "sidebar-accent"],
  ["sidebar-primary", "sidebar-accent"],
  ["sidebar-foreground", "sidebar-accent"],
  ["foreground", "card"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["muted-foreground", "muted"],
  ["primary-foreground", "primary"],
  ["primary", "background"],
  ["accent-foreground", "accent"],
  ["cite-foreground", "cite"],
  ["success", "background"],
  ["warning", "background"],
  ["info", "background"],
  ["destructive", "background"],
];

let failed = false;
for (const [name, block] of [["light", ":root {"], ["dark", ".dark {"]]) {
  const t = tokens(block);
  console.log(`\n${name} (AA text needs 4.5)`);
  for (const [fg, bg] of PAIRS) {
    if (!t[fg] || !t[bg]) { console.log(`skip  ${fg} on ${bg} (token not found)`); continue; }
    const r = ratio(t[fg], t[bg]);
    if (r < 4.5) failed = true;
    console.log(`${r >= 4.5 ? "pass" : "FAIL"}  ${r.toFixed(2).padStart(5)}  ${fg} on ${bg}`);
  }
}
process.exit(failed ? 1 : 0);
