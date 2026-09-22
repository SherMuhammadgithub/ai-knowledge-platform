import { createHash } from "node:crypto";
import { chunkFixed } from "./fixed";
import { chunkByHeadings } from "./headings";
import { chunkParagraphs } from "./paragraph";
import { type ChunkSettings, type ChunkStrategy, estimateTokens } from "./settings";

export { CHUNK_STRATEGIES, chunkSettingsFrom, estimateTokens } from "./settings";
export type { ChunkSettings, ChunkStrategy } from "./settings";

/** One row of document_chunks, before it is saved. */
export type ChunkDraft = {
  pageNumber: number;
  chunkIndex: number; // order within the document, from 0
  strategy: ChunkStrategy;
  startChar: number;
  endChar: number;
  text: string;
  tokenEstimate: number;
  contentHash: string;
  /** Heading of the section the chunk starts in. Set by the "heading" strategy only, null for the others. */
  heading: string | null;
};

const CHUNKERS = { fixed: chunkFixed, paragraph: chunkParagraphs, heading: chunkByHeadings } as const;

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Cuts every page into chunks. Chunks never cross a page, and `chunkIndex` runs on across the whole document. */
export function chunkPages(
  pages: { pageNumber: number; text: string }[],
  strategy: ChunkStrategy,
  settings: ChunkSettings,
): ChunkDraft[] {
  const chunker = CHUNKERS[strategy];
  const drafts: ChunkDraft[] = [];
  for (const page of [...pages].sort((a, b) => a.pageNumber - b.pageNumber)) {
    for (const piece of chunker(page.text, settings)) {
      drafts.push({
        pageNumber: page.pageNumber,
        chunkIndex: drafts.length,
        strategy,
        startChar: piece.startChar,
        endChar: piece.endChar,
        text: piece.text,
        tokenEstimate: estimateTokens(piece.text),
        contentHash: sha256(piece.text),
        heading: piece.heading ?? null,
      });
    }
  }
  return drafts;
}
