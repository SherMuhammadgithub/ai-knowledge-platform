# Milestone 3: document upload and storage

**Status:** built. Quiz unanswered.

## Goal

Accept PDF, Word and text files safely, store them, and keep each workspace's documents separate at the database level.

## What was built

- `documents` table (workspace, uploader, original name, type, size, SHA-256 hash, storage key, status). Duplicates per workspace are refused by the hash.
- The workspace-scoped database client `forWorkspace()` (`apps/api/src/prisma/tenant-client.ts`), plus two guard tests (unregistered tenant tables, raw SQL).
- `StorageService` on local disk, key `<workspaceId>/<documentId>`.
- File type decided from the bytes, not the name. Cleaned display names. Size limit while streaming (10 MB).
- API: upload, list, delete. Members delete their own uploads, admins and owners delete any.
- Web: documents list, upload, delete with confirmation.

## Read

- [`../../file-uploads.md`](../../file-uploads.md): type from bytes, names, storage keys, hashing, size limits.
- [`../../tenant-isolation.md`](../../tenant-isolation.md): the scoped client.
- Files are stored on disk under `storage/`. Their text is stored in Postgres from Milestone 4 on.

## Quiz

`docs/learning/QUIZ.md`, section "Milestone 3".

## Open

- Quiz unanswered.
