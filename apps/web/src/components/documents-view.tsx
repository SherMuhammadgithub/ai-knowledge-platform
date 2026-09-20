"use client";

import { CircleCheck, Clock, LoaderCircle, RotateCw, Trash2, TriangleAlert, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DocumentTextSheet, type TextViewState } from "@/components/document-text-sheet";
import { api, ApiError } from "@/lib/api";
import {
  ALLOWED_EXTENSIONS,
  type DocumentItem,
  type DocumentPagesResponse,
  type DocumentStatus,
  formatBytes,
  MAX_UPLOAD_BYTES,
  type Role,
  STATUS_LABEL,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type Upload = { key: number; name: string; state: "waiting" | "uploading" | "done" | "failed"; message?: string };

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));

// Same rule as the API: admins and owners delete anything, a member only their own uploads.
const canDelete = (role: Role, userId: string, doc: DocumentItem) =>
  role !== "MEMBER" || doc.uploadedBy?.id === userId;

// Quick checks so people get an answer before a big file is sent. The API checks again.
function precheck(file: File): string | null {
  const dot = file.name.lastIndexOf(".");
  const ext = dot > 0 ? file.name.slice(dot).toLowerCase() : "";
  if (!ALLOWED_EXTENSIONS.includes(ext)) return "Only PDF, DOCX and TXT files are supported";
  if (file.size === 0) return "This file is empty";
  if (file.size > MAX_UPLOAD_BYTES) return "This file is larger than 10 MB";
  return null;
}

// A document that has been waiting this long is probably stuck. Say so instead of implying it is normal.
const SLOW_AFTER_MS = 2 * 60_000;

/** The second line under the status: what it means, or why it failed. */
function statusLine(d: DocumentItem): string {
  if (d.status === "READY") {
    const size =
      d.type === "PDF"
        ? `${d.pageCount} ${d.pageCount === 1 ? "page" : "pages"}`
        : `${(d.charCount ?? 0).toLocaleString("en")} characters`;
    return d.chunkCount > 0 ? `${size}, ${d.chunkCount} ${d.chunkCount === 1 ? "chunk" : "chunks"}` : size;
  }
  if (d.status === "FAILED") return d.statusDetail ?? "This document could not be read.";
  if (d.status === "PROCESSING") return "Reading the file";
  return Date.now() - new Date(d.createdAt).getTime() > SLOW_AFTER_MS ? "Taking longer than usual" : "Waiting to be read";
}

// Status is always text plus an icon, never color alone. The icon carries the color.
const STATUS_ICON: Record<DocumentStatus, { Icon: typeof Clock; className: string }> = {
  UPLOADED: { Icon: Clock, className: "text-muted-foreground" },
  PROCESSING: { Icon: LoaderCircle, className: "animate-spin text-info" },
  READY: { Icon: CircleCheck, className: "text-success" },
  FAILED: { Icon: TriangleAlert, className: "text-destructive" },
};

function StatusBadge({ status }: { status: DocumentStatus }) {
  const { Icon, className } = STATUS_ICON[status];
  return (
    <Badge variant="secondary" className="gap-1">
      <Icon className={cn("size-3.5", className)} aria-hidden />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function DocumentsView({
  documents,
  workspaceName,
  actorRole,
  userId,
}: {
  documents: DocumentItem[];
  workspaceName: string;
  actorRole: Role;
  userId: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState<DocumentItem | null>(null);
  const [viewing, setViewing] = useState<DocumentItem | null>(null);
  const [view, setView] = useState<TextViewState | null>(null);

  // While anything is waiting or being read, look again every few seconds so the status changes by itself.
  const inProgress = documents.some((d) => d.status === "UPLOADED" || d.status === "PROCESSING");
  useEffect(() => {
    if (!inProgress) return;
    const timer = setInterval(() => {
      if (window.document.visibilityState === "visible") router.refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [inProgress, router]);

  async function openText(doc: DocumentItem) {
    setViewing(doc);
    setView({ state: "loading" });
    try {
      setView({ state: "ready", data: await api<DocumentPagesResponse>(`/documents/${doc.id}/pages`) });
    } catch (err) {
      setView({ state: "error", message: err instanceof ApiError ? err.message : "Could not load the text. Try again." });
    }
  }

  async function retry(doc: DocumentItem) {
    try {
      await api(`/documents/${doc.id}/retry`, { method: "POST" });
      toast.success("Retry started");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not retry. Try again.");
    }
  }

  const patch = (key: number, change: Partial<Upload>) =>
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...change } : u)));

  async function uploadFiles(files: File[]) {
    if (!files.length || busy) return;
    setBusy(true);
    const items: Upload[] = files.map((f, i) => ({ key: Date.now() + i, name: f.name, state: "waiting" }));
    setUploads(items);

    let succeeded = 0;
    // One at a time: simpler to report, and gentle on the server.
    for (const [i, file] of files.entries()) {
      const { key } = items[i];
      const problem = precheck(file);
      if (problem) {
        patch(key, { state: "failed", message: problem });
        continue;
      }
      patch(key, { state: "uploading" });
      try {
        const form = new FormData();
        form.append("file", file);
        await api("/documents", { method: "POST", body: form });
        patch(key, { state: "done" });
        succeeded++;
      } catch (err) {
        patch(key, { state: "failed", message: err instanceof ApiError ? err.message : "The upload failed. Try again." });
      }
    }

    // Finished files now show in the list. Failures stay here until dismissed, so nobody misses a reason.
    setUploads((list) => list.filter((u) => u.state === "failed"));
    setBusy(false);
    if (succeeded) {
      toast.success(succeeded === 1 ? "Document uploaded" : `${succeeded} documents uploaded`);
      router.refresh();
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    try {
      await api(`/documents/${target.id}`, { method: "DELETE" });
      toast.success("Document deleted");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete the document. Try again.");
    }
  }

  const uploadButton = (
    <Button onClick={() => inputRef.current?.click()} disabled={busy}>
      <Upload className="size-4" aria-hidden />
      {busy ? "Uploading..." : "Upload documents"}
    </Button>
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void uploadFiles([...e.dataTransfer.files]);
      }}
      className={cn("-m-3 rounded-lg p-3 transition-colors", dragging && "bg-primary/5 outline-2 outline-dashed outline-primary/50")}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ALLOWED_EXTENSIONS.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose documents to upload"
        onChange={(e) => {
          void uploadFiles([...(e.target.files ?? [])]);
          e.target.value = ""; // lets the same file be chosen again
        }}
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Documents</h1>
          <p className="mt-1 text-muted-foreground">Files in {workspaceName}.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            PDF, DOCX or TXT, up to 10 MB each. Use public documents only.
          </p>
        </div>
        {documents.length > 0 && uploadButton}
      </div>

      {uploads.length > 0 && (
        <ul aria-live="polite" className="mt-6 divide-y rounded-lg border">
          {uploads.map((u) => (
            <li key={u.key} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="min-w-0 truncate font-medium">{u.name}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className={cn(u.state === "failed" ? "text-destructive" : "text-muted-foreground")}>
                  {u.state === "waiting" && "Waiting"}
                  {u.state === "uploading" && "Uploading..."}
                  {u.state === "done" && "Uploaded"}
                  {u.state === "failed" && u.message}
                </span>
                {u.state === "failed" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`Dismiss ${u.name}`}
                    onClick={() => setUploads((list) => list.filter((x) => x.key !== u.key))}
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {documents.length === 0 ? (
        <div className="mt-16 flex flex-col items-center text-center">
          <h2 className="text-lg font-semibold">No documents yet</h2>
          <p className="mt-2 max-w-sm text-muted-foreground">
            Upload the files you want to ask questions about. You can also drop them anywhere on this page.
          </p>
          <div className="mt-6">{uploadButton}</div>
        </div>
      ) : (
        <>
          <p className="mb-3 mt-8 text-sm text-muted-foreground">
            {documents.length === 1 ? "1 document" : `${documents.length} documents`}
          </p>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead className="hidden md:table-cell">Type</TableHead>
                  <TableHead className="hidden pr-8 text-right sm:table-cell">Size</TableHead>
                  <TableHead className="hidden md:table-cell">Uploaded</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((d) => (
                  <TableRow key={d.id} className="group h-14">
                    <TableCell className="max-w-44 sm:max-w-72">
                      {d.status === "READY" ? (
                        <button
                          type="button"
                          onClick={() => void openText(d)}
                          className="block max-w-full truncate rounded-sm text-left font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                          title={`Show the text read from ${d.name}`}
                        >
                          {d.name}
                        </button>
                      ) : (
                        <div className="truncate font-medium" title={d.name}>
                          {d.name}
                        </div>
                      )}
                      <div className="truncate text-sm text-muted-foreground">
                        {d.uploadedBy ? (d.uploadedBy.name ?? d.uploadedBy.email) : "Removed user"}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge variant="outline">{d.type}</Badge>
                    </TableCell>
                    <TableCell className="hidden pr-8 text-right font-mono text-sm tabular-nums text-muted-foreground sm:table-cell">
                      {formatBytes(d.sizeBytes)}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{formatDate(d.createdAt)}</TableCell>
                    <TableCell className="max-w-56 whitespace-normal">
                      <StatusBadge status={d.status} />
                      <div className={cn("mt-1 text-sm", d.status === "FAILED" ? "text-destructive" : "text-muted-foreground")}>
                        {statusLine(d)}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {d.status === "FAILED" && canDelete(actorRole, userId, d) && (
                        <Button variant="ghost" size="sm" onClick={() => void retry(d)} aria-label={`Retry ${d.name}`}>
                          <RotateCw className="size-3.5" aria-hidden />
                          Retry
                        </Button>
                      )}
                      {canDelete(actorRole, userId, d) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100 max-lg:opacity-100"
                          onClick={() => setDeleting(d)}
                          aria-label={`Delete ${d.name}`}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It is removed from {workspaceName} for everyone. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              Delete document
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DocumentTextSheet
        document={viewing}
        view={view}
        onClose={() => {
          setViewing(null);
          setView(null);
        }}
        onRetry={() => viewing && void openText(viewing)}
      />
    </div>
  );
}
