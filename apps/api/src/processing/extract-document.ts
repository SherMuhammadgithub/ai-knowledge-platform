import { cleanPages } from "./clean-text";
import { PermanentProcessingError } from "./errors";
import { extractDocx } from "./extract-docx";
import { extractPdf } from "./extract-pdf";
import { DEFAULT_LIMITS, type ProcessingLimits } from "./limits";

export type DocumentKind = "PDF" | "DOCX" | "TXT";

export type ExtractedDocument = {
  /** Cleaned text, one string per page. Formats without pages have exactly one. */
  pages: string[];
  charCount: number;
  /** Header and footer lines that were removed, so the effect of cleaning can be inspected. */
  removedBoilerplate: string[];
};

/** Below this many characters in total, a document is treated as having no readable text. */
const MIN_CHARS = 20;

function decodeText(bytes: Buffer): string {
  // Upload already checked that this is valid UTF-8. Drop a byte order mark if there is one.
  return new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
}

/**
 * The whole reading step for one file: extract the raw text page by page, clean it, and decide whether
 * anything readable came out. Pure: no database, no storage, so it is easy to test with real files.
 *
 * Every failure that comes from the file itself is a PermanentProcessingError with a reason for the user.
 */
export async function extractDocument(
  kind: DocumentKind,
  bytes: Buffer,
  limits: ProcessingLimits = DEFAULT_LIMITS,
): Promise<ExtractedDocument> {
  const deadline = Date.now() + limits.timeoutMs;

  let raw: string[];
  try {
    if (kind === "PDF") raw = await extractPdf(bytes, limits, deadline);
    else if (kind === "DOCX") raw = await extractDocx(bytes, limits);
    else raw = [decodeText(bytes)];
  } catch (err) {
    if (err instanceof PermanentProcessingError) throw err;
    // The parsers throw all sorts of things for damaged input. Trying the same bytes again would fail the same way.
    throw new PermanentProcessingError("This file could not be read. It may be damaged or in an unsupported format.");
  }

  const { pages, removedBoilerplate } = cleanPages(raw, { pdfLayout: kind === "PDF" });
  const charCount = pages.reduce((sum, p) => sum + p.length, 0);

  if (charCount < MIN_CHARS) {
    throw new PermanentProcessingError(
      kind === "PDF"
        ? "This PDF has no readable text. It may be a scan or only pictures. Scanned documents are not supported yet."
        : "This document has no readable text.",
    );
  }
  if (charCount > limits.maxChars) {
    throw new PermanentProcessingError("This document contains too much text to process.");
  }
  return { pages, charCount, removedBoilerplate };
}
