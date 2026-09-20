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
export type DocumentStatus = "UPLOADED" | "PROCESSING" | "READY" | "FAILED";

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
  processedAt: string | null;
  createdAt: string;
  uploadedBy: { id: string; name: string | null; email: string } | null;
};

export type DocumentPagesResponse = {
  document: DocumentItem;
  pages: { pageNumber: number; text: string }[];
};

export const STATUS_LABEL: Record<DocumentStatus, string> = {
  UPLOADED: "Uploaded",
  PROCESSING: "Processing",
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
