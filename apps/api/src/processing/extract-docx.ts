import { unzipSync } from "fflate";
import mammoth from "mammoth";
import { PermanentProcessingError } from "./errors";
import type { ProcessingLimits } from "./limits";

/**
 * A DOCX is a zip file. A "zip bomb" is a tiny zip that expands to gigabytes when opened. This reads only the
 * zip's table of contents (the declared sizes), never the contents, and refuses anything that would expand too far.
 */
export function guardZip(bytes: Buffer, limits: ProcessingLimits): void {
  let total = 0;
  let entries = 0;
  try {
    unzipSync(new Uint8Array(bytes), {
      // Returning false skips the file, so nothing is decompressed here.
      filter: (file) => {
        entries++;
        total += file.originalSize;
        return false;
      },
    });
  } catch {
    throw new PermanentProcessingError("This Word file could not be read. It may be damaged.");
  }
  if (entries > limits.maxZipEntries || total > limits.maxUncompressedBytes) {
    throw new PermanentProcessingError("This Word file is too large to process once unpacked.");
  }
}

/** Word documents have no fixed pages, so the whole text comes back as a single page. */
export async function extractDocx(bytes: Buffer, limits: ProcessingLimits): Promise<string[]> {
  guardZip(bytes, limits);
  try {
    const { value } = await mammoth.extractRawText({ buffer: bytes });
    return [value];
  } catch {
    throw new PermanentProcessingError("This Word file could not be read. It may be damaged.");
  }
}
