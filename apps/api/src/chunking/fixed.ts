import { type ChunkPiece, type ChunkSettings, pieceOf, trimRange } from "./settings";

/**
 * The naive chunker: cut every `targetChars` characters, and start the next chunk `overlapChars` earlier.
 *
 * It ignores words, sentences and paragraphs, so it cuts them in half. It is kept on purpose:
 * it shows what naive chunking does to a page, and it is the baseline the paragraph chunker is
 * compared against in Milestone 6.
 */
export function chunkFixed(text: string, { targetChars, overlapChars }: ChunkSettings): ChunkPiece[] {
  const pieces: ChunkPiece[] = [];
  const step = targetChars - overlapChars;

  for (let start = 0; start < text.length; start += step) {
    const end = Math.min(start + targetChars, text.length);
    const range = trimRange(text, start, end);
    if (range) pieces.push(pieceOf(text, range.start, range.end));
    if (end === text.length) break;
  }
  return pieces;
}
