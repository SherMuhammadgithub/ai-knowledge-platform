import { chunkParagraphs, HARD_MAX_SHARE, paragraphRanges, TAIL_SHARE } from "./paragraph";
import { type ChunkPiece, type ChunkSettings, pieceOf } from "./settings";

// Milestone 6, Checkpoint D. Reading a file keeps only plain text, so headings have to be guessed from how the text
// looks. This works on text files and on the text of Word files and PDFs. It is a heuristic and it can be wrong.

const MAX_HEADING_CHARS = 80;
const MAX_HEADING_WORDS = 12;

/**
 * Does this block of text (the lines between two blank lines) look like a heading?
 *
 * Yes: one short line that starts with a capital letter or a digit, does not end like a sentence, and is not a
 * list item, a table row, a web address, an e-mail address or a "Label: value" line. (A bullet needs no rule of
 * its own: it starts with a dash or a dot, not with a letter or a digit.)
 * Numbered headings ("4.2 Annual leave", "1. Overview") count. List items ("- item", "1) item") do not.
 */
export function looksLikeHeading(block: string): boolean {
  if (block.includes("\n")) return false;
  const line = block.trim();
  if (line.length < 2 || line.length > MAX_HEADING_CHARS) return false;
  if (line.split(/\s+/).length > MAX_HEADING_WORDS) return false;
  if (/[.,;:!]$/.test(line)) return false; // ends like a sentence or introduces a list
  if (/^\d+[.)]\s/.test(line) && !/^\d+\.\s+\p{Lu}/u.test(line)) return false; // "1) item" or "2. lower case"
  if (/:\/\/|@| \| /.test(line)) return false; // address or table row
  if (/:\s/.test(line)) return false; // "Telephone: 0300 ..." and "Source: ..."
  return /^[\p{Lu}\d]/u.test(line);
}

export type Heading = { start: number; end: number; text: string };

/** Where the headings of a page are. Ranges are positions inside the page text. */
export function detectHeadings(text: string): Heading[] {
  return paragraphRanges(text)
    .map((b) => ({ ...b, text: text.slice(b.start, b.end) }))
    .filter((b) => looksLikeHeading(b.text));
}

/** A heading and the text under it, up to the next heading. The text before the first heading has no heading. */
type Section = { start: number; end: number; heading: string | null };

function sectionsOf(text: string): Section[] | null {
  const blocks = paragraphRanges(text).map((b) => ({ ...b, text: text.slice(b.start, b.end) }));
  const isHeading = blocks.map((b) => looksLikeHeading(b.text));
  if (!isHeading.some(Boolean)) return null;

  const sections: Section[] = [];
  let current: Section | null = null;
  let previousWasHeading = false;
  blocks.forEach((b, i) => {
    if (isHeading[i]) {
      if (current && previousWasHeading) {
        // A title followed at once by a sub-heading: one section, named by the more specific heading.
        current.end = b.end;
        current.heading = b.text;
      } else {
        current = { start: b.start, end: b.end, heading: b.text };
        sections.push(current);
      }
    } else if (current) {
      current.end = b.end;
    } else {
      current = { start: b.start, end: b.end, heading: null };
      sections.push(current);
    }
    previousWasHeading = isHeading[i];
  });
  return sections;
}

/**
 * Heading-aware chunker. Works on one page of text.
 *
 *  1. Find the headings and cut the page into sections (a heading and the text under it).
 *  2. Pack whole sections, in order, into a chunk until the next section would pass the target size. A chunk
 *     therefore always starts at a heading and never ends in the middle of a section.
 *  3. A section longer than the target is split with the paragraph chunker (sentences, overlap), and each piece
 *     keeps that section's heading in `heading`. Only the first piece contains the heading text itself.
 *  4. A tiny leftover at the end joins the previous chunk.
 *  5. A page with no detectable headings is cut exactly like the paragraph chunker cuts it.
 *
 * There is no overlap between sections: a section is a unit of meaning of its own. Each chunk's `heading` is the
 * heading of the first section in it.
 *
 * Known costs: heading detection is a guess. A wrong guess moves a boundary, it does not lose text. Chunks are
 * smaller on average than paragraph chunks, because a section that does not fit ends the chunk early.
 */
export function chunkByHeadings(text: string, settings: ChunkSettings): ChunkPiece[] {
  const sections = sectionsOf(text);
  if (!sections) return chunkParagraphs(text, settings);

  const { targetChars } = settings;
  const pieces: ChunkPiece[] = [];
  let open: Section | null = null;
  const flush = () => {
    if (open) pieces.push({ ...pieceOf(text, open.start, open.end), heading: open.heading });
    open = null;
  };

  for (const section of sections) {
    if (section.end - section.start > targetChars) {
      flush();
      for (const p of chunkParagraphs(text.slice(section.start, section.end), settings)) {
        pieces.push({ ...pieceOf(text, section.start + p.startChar, section.start + p.endChar), heading: section.heading });
      }
    } else if (open && section.end - open.start <= targetChars) {
      open.end = section.end;
    } else {
      flush();
      open = { ...section };
    }
  }
  flush();

  // step 4
  if (pieces.length >= 2) {
    const last = pieces[pieces.length - 1];
    const before = pieces[pieces.length - 2];
    if (last.endChar - last.startChar < targetChars * TAIL_SHARE && last.endChar - before.startChar <= Math.floor(targetChars * HARD_MAX_SHARE)) {
      pieces.splice(pieces.length - 2, 2, { ...pieceOf(text, before.startChar, last.endChar), heading: before.heading });
    }
  }
  return pieces;
}
