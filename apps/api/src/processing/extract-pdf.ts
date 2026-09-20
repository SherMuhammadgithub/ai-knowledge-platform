import { createRequire } from "node:module";
import { PermanentProcessingError } from "./errors";
import type { ProcessingLimits } from "./limits";

// pdfjs ships as an ES module and this API compiles to CommonJS. Node 22.13 and newer (the minimum pdfjs itself
// requires) can require() an ES module directly, so it is loaded once and reused.
let pdfjsModule: any;
const loadPdfjs = () => (pdfjsModule ??= createRequire(__filename)("pdfjs-dist/legacy/build/pdf.mjs"));

type TextItem = { str: string; transform: number[]; width: number; height: number };

/**
 * Turns pdfjs's positioned text runs back into lines and paragraphs. Position decides the breaks:
 * a run at a new height starts a new line, a big vertical jump starts a new paragraph, and a horizontal gap
 * inside a line becomes a space (many PDFs draw words as separate runs with no space character).
 */
export function itemsToText(items: TextItem[]): string {
  let out = "";
  let prev: TextItem | undefined;
  for (const item of items) {
    if (!item.str) continue; // pdfjs emits empty runs to mark line ends
    if (prev) {
      const size = Math.max(prev.height, item.height, 1);
      const drop = prev.transform[5] - item.transform[5]; // PDF y grows upward, so a new line has a smaller y
      if (Math.abs(drop) >= size * 0.5) out += drop > size * 1.9 || drop < -size * 1.9 ? "\n\n" : "\n";
      else {
        const gap = item.transform[4] - (prev.transform[4] + prev.width);
        if (gap > size * 0.15 && !out.endsWith(" ") && !item.str.startsWith(" ")) out += " ";
      }
    }
    out += item.str;
    prev = item;
  }
  return out;
}

const explain = (err: unknown): PermanentProcessingError => {
  const name = (err as { name?: string })?.name;
  if (name === "PasswordException") return new PermanentProcessingError("This PDF is password protected. Remove the password and upload it again.");
  return new PermanentProcessingError("This PDF could not be read. It may be damaged.");
};

/** Raw text of each page, in order. A page with no text (blank, or only pictures) gives an empty string. */
export async function extractPdf(bytes: Buffer, limits: ProcessingLimits, deadline: number): Promise<string[]> {
  const pdfjs = loadPdfjs();
  // pdfjs takes ownership of the buffer it is given, so it gets a copy.
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    verbosity: 0,
    isEvalSupported: false, // no code generation from untrusted files
    useSystemFonts: false,
    disableFontFace: true,
  });

  try {
    const pdf = await task.promise.catch((err: unknown) => {
      throw explain(err);
    });
    if (pdf.numPages > limits.maxPages) {
      throw new PermanentProcessingError(`This PDF has ${pdf.numPages} pages. The limit is ${limits.maxPages}.`);
    }

    const pages: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      if (Date.now() > deadline) throw new PermanentProcessingError("Reading this document took too long.");
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      pages.push(itemsToText(content.items as TextItem[]));
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy?.();
  }
}
