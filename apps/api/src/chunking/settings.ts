import type { Env } from "../config/env";

// Milestone 4 stores clean text per page. Chunking cuts each page into pieces that are small enough to embed
// and to hand to a language model, and big enough to keep an idea together.

export type ChunkStrategy = "paragraph" | "fixed";
export const CHUNK_STRATEGIES: readonly ChunkStrategy[] = ["paragraph", "fixed"];

/** Sizes in characters. Token counts are estimates: characters / 4 (measured in Milestone 5, Checkpoint A). */
export type ChunkSettings = { targetChars: number; overlapChars: number };

export const CHARS_PER_TOKEN = 4;
export const estimateTokens = (text: string) => Math.ceil(text.length / CHARS_PER_TOKEN);

export function chunkSettingsFrom(env: Pick<Env, "CHUNK_TARGET_TOKENS" | "CHUNK_OVERLAP_TOKENS">): ChunkSettings {
  return {
    targetChars: env.CHUNK_TARGET_TOKENS * CHARS_PER_TOKEN,
    overlapChars: env.CHUNK_OVERLAP_TOKENS * CHARS_PER_TOKEN,
  };
}

/**
 * One chunk of one page. The invariant everything else relies on (highlighting, citations, tests):
 * page.text.slice(startChar, endChar) === text
 */
export type ChunkPiece = { startChar: number; endChar: number; text: string };

/** Shrinks a range so it starts and ends on non-whitespace. Returns null if nothing is left. */
export function trimRange(text: string, start: number, end: number): { start: number; end: number } | null {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(text[s])) s++;
  while (e > s && /\s/.test(text[e - 1])) e--;
  return s < e ? { start: s, end: e } : null;
}

export const pieceOf = (text: string, start: number, end: number): ChunkPiece => ({
  startChar: start,
  endChar: end,
  text: text.slice(start, end),
});
