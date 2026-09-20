// Shapes returned by the NestJS API. Keep in sync with apps/api.

export type Role = "OWNER" | "ADMIN" | "MEMBER";

export type Me = {
  user: { id: string; email: string; name: string | null };
  workspaces: { id: string; name: string; role: Role }[];
  activeWorkspaceId: string | null;
};

export type Member = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  joinedAt: string;
};

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
};

export type DocumentType = "PDF" | "DOCX" | "TXT";
export type DocumentStatus = "UPLOADED" | "PROCESSING" | "INDEXING" | "READY" | "FAILED";

export type DocumentItem = {
  id: string;
  name: string;
  type: DocumentType;
  sizeBytes: number;
  status: DocumentStatus;
  /** Plain-language reason, set when status is FAILED. */
  statusDetail: string | null;
  /** Set when READY. Formats without pages (TXT, DOCX) count as one page. */
  pageCount: number | null;
  charCount: number | null;
  /** Pieces the text was cut into for search (0 until the document is Ready, or if it has not been chunked yet). */
  chunkCount: number;
  /** How many of those chunks have a vector under the current embedding setup. Ready with fewer means "not searchable yet". */
  embeddedCount: number;
  processedAt: string | null;
  createdAt: string;
  uploadedBy: { id: string; name: string | null; email: string } | null;
};

export type DocumentPagesResponse = {
  document: DocumentItem;
  pages: { pageNumber: number; text: string }[];
};

export type DocumentChunk = {
  /** Order within the document, from 0. */
  chunkIndex: number;
  pageNumber: number;
  text: string;
  /** Estimated (characters / 4), not a real token count. */
  tokenEstimate: number;
  /** How many characters at the start of this chunk repeat the end of the previous chunk on the same page. */
  overlapWithPrevious: number;
  /** Whether this chunk has a vector under the current embedding setup. */
  embedded: boolean;
};

export type DocumentChunksResponse = {
  document: DocumentItem;
  strategy: "paragraph" | "fixed";
  chunks: DocumentChunk[];
};

export const STATUS_LABEL: Record<DocumentStatus, string> = {
  UPLOADED: "Uploaded",
  PROCESSING: "Processing",
  INDEXING: "Indexing",
  READY: "Ready",
  FAILED: "Failed",
};

// Mirrors the API limits (MAX_UPLOAD_MB and the allowed types) so people get an answer before the upload starts.
// The API checks everything again: this is only for speed and clear messages.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".txt"];

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
