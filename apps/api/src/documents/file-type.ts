// Decides what a file REALLY is from its bytes. The name and the type a browser reports are
// just text the user controls, so they are never trusted on their own.
//
// These are signature checks, enough to stop an executable renamed to .pdf. They do not prove a file is
// well formed. Text extraction (Milestone 4) is the real parser and must handle broken files itself.

export type DocumentKind = "PDF" | "DOCX" | "TXT";

export const EXTENSION_KIND: Record<string, DocumentKind> = {
  ".pdf": "PDF",
  ".docx": "DOCX",
  ".txt": "TXT",
};

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

// PDFs start with "%PDF-", though the spec tolerates a little junk before it.
function looksLikePdf(buf: Buffer): boolean {
  return buf.subarray(0, 1024).includes("%PDF-");
}

// A DOCX is a zip ("PK\x03\x04") with a content-types part and a Word document part. File names inside a
// zip are stored uncompressed, so a substring search finds them. This tells a DOCX from an XLSX or a plain zip.
function looksLikeDocx(buf: Buffer): boolean {
  return (
    buf.length > 4 &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    buf[2] === 0x03 &&
    buf[3] === 0x04 &&
    buf.includes("[Content_Types].xml") &&
    buf.includes("word/document.xml")
  );
}

// Plain text: no NUL bytes near the start (binary files have them) and valid UTF-8 throughout.
function looksLikeText(buf: Buffer): boolean {
  if (buf.subarray(0, 8192).includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

export function detectKind(buf: Buffer): DocumentKind | null {
  if (looksLikePdf(buf)) return "PDF";
  if (looksLikeDocx(buf)) return "DOCX";
  if (looksLikeText(buf)) return "TXT";
  return null;
}

/**
 * The name we keep for display. The upload library hands us the raw bytes of the name read as latin1, so
 * non-ASCII names arrive garbled: undo that. Then strip any folder part and control characters, and
 * shorten. This is display text only. It is never used to build a path.
 */
export function cleanFileName(raw: string): string {
  let name = Buffer.from(raw, "latin1").toString("utf8");
  if (name.includes("�")) name = raw; // was already proper UTF-8, keep it as sent
  name = name.split(/[\\/]/).pop() ?? "";
  name = name.replace(/[\u0000-\u001f\u007f]/g, "").normalize("NFC").trim();
  if (name.length > 200) {
    const ext = extensionOf(name);
    name = name.slice(0, 200 - ext.length) + ext;
  }
  return name || "document";
}
