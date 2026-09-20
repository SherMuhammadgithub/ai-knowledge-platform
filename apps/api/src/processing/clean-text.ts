// Cleaning turns extracted text into text that is good to read, chunk and embed.
// Every rule is conservative on purpose: removing real content is worse than keeping a little noise.

const LIGATURES: Record<string, string> = {
  "\uFB00": "ff",
  "\uFB01": "fi",
  "\uFB02": "fl",
  "\uFB03": "ffi",
  "\uFB04": "ffl",
  "\uFB05": "st",
  "\uFB06": "st",
};

/**
 * Character-level tidying that is safe for any format: unify line endings, expand ligatures, drop
 * invisible characters, turn odd spaces into normal ones, collapse runs of spaces. Line breaks are kept.
 */
export function normalizeCharacters(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\uFB00-\uFB06]/g, (c) => LIGATURES[c] ?? c)
    .replace(/\u00AD/g, "") // soft hyphen: an invisible "you may break here" mark
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "") // zero-width characters
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ") // non-breaking and wide spaces
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "") // control characters, except tab and newline
    .replace(/\t/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/ ?\n ?/g, "\n");
}

/**
 * Layout artifacts of PDFs. PDF text comes as visual lines, so a word split by a line break ("quar-\nter")
 * is rejoined, and a line that stops mid-sentence is joined to the next one.
 *
 * Deliberately NOT done: joining when the next line starts with a capital or a symbol, so lists, headings
 * and short lines stay as they are. Known cost: "well-\nknown" becomes "wellknown".
 */
export function repairPdfLines(text: string): string {
  return text
    .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2")
    .replace(/([^\s.!?:;])\n(?=\p{Ll})/gu, "$1 ");
}

function tidyBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

// "Page 3 of 10", "3 / 10", "- 4 -", "7": lines that only carry a page number.
const PAGE_NUMBER = /^(?:page|p\.?)?\s*\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$/i;
const isPageNumberLine = (line: string) => PAGE_NUMBER.test(line.trim().replace(/^[\s\-–—.|()[\]]+|[\s\-–—.|()[\]]+$/g, ""));

// Lines are compared exactly (ignoring case and spacing), so two body lines that differ only by a number are
// never mistaken for each other. Page-number lines share one key, because their digits change on every page.
const lineKey = (line: string) => (isPageNumberLine(line) ? "\u0000page-number" : line.trim().replace(/\s+/g, " ").toLowerCase());

/** A page needs at least this many lines of text before its first and last lines can be told apart from body. */
const MIN_LINES_FOR_EDGES = 5;

/**
 * Page headers and footers ("Acme Corp Confidential", "Page 3 of 10") repeat on most pages. Left in, they
 * become fake content in every chunk. A line counts as boilerplate when it is short, sits in the first or last
 * two lines of a page, and either repeats exactly on at least half the pages (and at least three), or is a bare
 * page number. Only those edge positions are touched: the same words in the body of a page are kept, and pages
 * with very little text are left alone.
 */
export function removeRepeatedBoilerplate(pages: string[]): { pages: string[]; removed: string[] } {
  const withText = pages.filter((p) => p.trim()).length;
  if (pages.length < 3 || withText < 3) return { pages, removed: [] };

  const edgeIndexes = (lines: string[]): number[] => {
    const filled = lines.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);
    if (filled.length < MIN_LINES_FOR_EDGES) return [];
    return [...filled.slice(0, 2), ...filled.slice(-2)];
  };

  const counts = new Map<string, number>();
  for (const page of pages) {
    const lines = page.split("\n");
    const seen = new Set<string>();
    for (const i of edgeIndexes(lines)) {
      if (lines[i].length > 100) continue;
      seen.add(lineKey(lines[i]));
    }
    for (const key of seen) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const threshold = Math.max(3, Math.ceil(withText * 0.5));
  const boilerplate = new Set([...counts].filter(([, n]) => n >= threshold).map(([key]) => key));
  if (!boilerplate.size) return { pages, removed: [] };

  const removed = new Set<string>();
  const cleaned = pages.map((page) => {
    const lines = page.split("\n");
    const drop = new Set(edgeIndexes(lines).filter((i) => lines[i].length <= 100 && boilerplate.has(lineKey(lines[i]))));
    for (const i of drop) removed.add(lines[i].trim());
    return lines.filter((_, i) => !drop.has(i)).join("\n");
  });
  return { pages: cleaned, removed: [...removed] };
}

export type CleanOptions = {
  /** True for PDFs, whose line breaks come from page layout. TXT and DOCX keep their own paragraphs. */
  pdfLayout: boolean;
};

export function cleanPages(rawPages: string[], { pdfLayout }: CleanOptions): { pages: string[]; removedBoilerplate: string[] } {
  let pages = rawPages.map(normalizeCharacters);
  let removedBoilerplate: string[] = [];
  if (pdfLayout) {
    const result = removeRepeatedBoilerplate(pages);
    pages = result.pages;
    removedBoilerplate = result.removed;
    pages = pages.map(repairPdfLines);
  }
  return { pages: pages.map(tidyBlankLines), removedBoilerplate };
}
