import { type ChunkPiece, type ChunkSettings, pieceOf, trimRange } from "./settings";

// A leftover smaller than this share of the target is merged into the previous chunk instead of standing alone...
const TAIL_SHARE = 0.15;
// ...as long as the merged chunk stays under this share of the target. No chunk is ever larger than that.
export const HARD_MAX_SHARE = 1.25;

const sentenceSegmenter = new Intl.Segmenter("en", { granularity: "sentence" });

/** A sentence (or a piece of a very long sentence), with the paragraph it belongs to. */
type Unit = { start: number; end: number; para: number; paraFits: boolean };

/** Paragraphs are separated by a blank line. Ranges are trimmed and never empty. */
function paragraphRanges(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const add = (start: number, end: number) => {
    const range = trimRange(text, start, end);
    if (range) out.push(range);
  };
  let cursor = 0;
  for (const m of text.matchAll(/\n[ \t]*\n\s*/g)) {
    add(cursor, m.index);
    cursor = m.index + m[0].length;
  }
  add(cursor, text.length);
  return out;
}

/** Last resort for a sentence longer than the target: cut at a space, or in the middle of a word if there is none. */
function splitAtWords(text: string, start: number, end: number, target: number) {
  const out: { start: number; end: number }[] = [];
  let s = start;
  while (end - s > target) {
    let cut = s + target;
    while (cut > s && !/\s/.test(text[cut])) cut--;
    if (cut <= s) cut = s + target; // no space anywhere: hard cut
    const range = trimRange(text, s, cut);
    if (range) out.push(range);
    s = cut;
    while (s < end && /\s/.test(text[s])) s++;
  }
  const rest = trimRange(text, s, end);
  if (rest) out.push(rest);
  return out;
}

function toUnits(text: string, target: number): Unit[] {
  const units: Unit[] = [];
  paragraphRanges(text).forEach((p, para) => {
    const paraFits = p.end - p.start <= target;
    for (const seg of sentenceSegmenter.segment(text.slice(p.start, p.end))) {
      const range = trimRange(text, p.start + seg.index, p.start + seg.index + seg.segment.length);
      if (!range) continue;
      const parts = range.end - range.start > target ? splitAtWords(text, range.start, range.end, target) : [range];
      for (const part of parts) units.push({ ...part, para, paraFits });
    }
  });
  return units;
}

/**
 * The production-style chunker. Works on one page of text.
 *
 *  1. Split the page into paragraphs, and each paragraph into sentences (Intl.Segmenter).
 *  2. Pack sentences into a chunk until the next one would pass the target size.
 *  3. If the break would fall inside a paragraph that fits on its own, move the break to the start of that paragraph,
 *     so short paragraphs are not cut. A paragraph longer than the target is split at sentences.
 *  4. A sentence longer than the target is cut at a space (last resort).
 *  5. The next chunk starts with the last sentences of the previous one, up to `overlapChars`.
 *  6. A tiny leftover at the end joins the previous chunk instead of standing alone.
 *
 * Known costs: sentence splitting is a heuristic (unusual abbreviations can be split wrongly), a table or
 * list is just text so a row can end up in a neighbouring chunk, and overlap is made of whole sentences, so
 * when every sentence is longer than the overlap size a chunk gets no overlap at all.
 */
export function chunkParagraphs(text: string, { targetChars, overlapChars }: ChunkSettings): ChunkPiece[] {
  const units = toUnits(text, targetChars);
  const pieces: ChunkPiece[] = [];
  const hardMax = Math.floor(targetChars * HARD_MAX_SHARE);
  const last = units.length - 1;

  let a = 0; // first unit of the chunk being built
  let previousEnd = 0; // one past the last unit of the previous chunk
  while (a < units.length) {
    // j is one past the last unit that fits. A chunk always holds at least one unit.
    let j = a + 1;
    while (j < units.length && units[j].end - units[a].start <= targetChars) j++;

    if (j < units.length) {
      const leftover = units[last].end - units[j].start;
      if (leftover < targetChars * TAIL_SHARE && units[last].end - units[a].start <= hardMax) {
        j = units.length; // step 6
      } else if (units[j - 1].para === units[j].para && units[j].paraFits) {
        // step 3: the break would cut a paragraph that fits whole. Move it back to the paragraph's first unit,
        // unless that would leave this chunk with nothing the previous chunk did not already contain.
        let k = j;
        while (k > a && units[k - 1].para === units[j].para) k--;
        if (k > a && k > previousEnd) j = k;
      }
    }

    pieces.push(pieceOf(text, units[a].start, units[j - 1].end));
    if (j >= units.length) break;
    previousEnd = j;

    // step 5: walk back from the end of this chunk while the overlap stays small enough...
    let next = j;
    while (next - 1 > a && units[j - 1].end - units[next - 1].start <= overlapChars) next--;
    // ...but the new chunk (overlap plus its first new unit) must still fit.
    while (next < j && units[j].end - units[next].start > targetChars) next++;
    a = next;
  }
  return pieces;
}
