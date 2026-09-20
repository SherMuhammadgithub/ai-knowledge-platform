# File uploads and storage (Milestone 3)

An extra topic beyond the ten planned files. It is the door into the RAG pipeline: everything later (extraction, chunking, embeddings) starts from a stored file.

## Concept

An upload endpoint accepts bytes from the outside world. Treat everything about those bytes as untrusted: the name, the type the browser reports, the size, and the content. Decide what the file is from the content, store it under a name you generate, and record a hash of it so duplicates are found without comparing files.

## Why it matters for this product

- The document is the input to the language model. A file that is not what it claims to be wastes quota later, or breaks the parser.
- Files come from users, so they are also the path for the prompt-injection attacks in Milestone 12.
- Uploads are per workspace. A bug here leaks one company's documents to another.

## Mental model

```
browser -> web proxy (/api) -> API
   1. size cap while the file streams in         (413 if over)
   2. name is read as text, cleaned, kept for display only
   3. extension must be pdf, docx or txt         (415 otherwise)
   4. the BYTES must match that extension        (415 if not)
   5. SHA-256 of the bytes -> already in this workspace?   (409 if yes)
   6. write the file to  <workspaceId>/<documentId>   (names we generated)
   7. write the database row (status UPLOADED). If that fails, delete the file again
```

## What we implemented, and where

| Piece | File |
|---|---|
| Type detection from bytes, filename cleaning | `apps/api/src/documents/file-type.ts` |
| Upload, list, delete rules | `apps/api/src/documents/documents.service.ts` |
| Routes (no workspace id anywhere) | `apps/api/src/documents/documents.controller.ts` |
| Size limit (`MAX_UPLOAD_MB`) | `apps/api/src/documents/documents.module.ts`, `config/env.ts` |
| Storage interface and local-disk version with path safety | `apps/api/src/storage/` |
| The table | `apps/api/prisma/schema.prisma` (`Document`), unique on (workspace, content hash) |
| The screen | `apps/web/src/components/documents-view.tsx` |
| Proxy body limit | `apps/web/next.config.ts` |
| Tests | `apps/api/test/documents.e2e.spec.ts`, `uploads.spec.ts` |

## How each check works

- **Type from bytes.** A PDF starts with `%PDF-`. A DOCX is a zip (`PK\x03\x04`) that contains the parts `[Content_Types].xml` and `word/document.xml`, which tells it apart from an XLSX. Text has no signature, so it must have no NUL bytes near the start and be valid UTF-8. The result must match the extension, so an executable renamed `invoice.pdf` is refused.
- **Filename.** The upload library reads names as latin1, so non-ASCII names arrive garbled and are decoded back. Folder parts (`../../etc/passwd.txt`) and control characters are removed, and the length is capped. It is used only for display. The stored path never contains it.
- **Storage keys.** Generated as `<workspaceId>/<documentId>`. The storage code also refuses any key that is not letters, digits, dash, underscore and single slashes, and checks the final path stays inside the storage folder. A key is written once and never overwritten.
- **Duplicates.** Compared by SHA-256 within one workspace. Two identical uploads at the same moment are handled by the database's unique index: one wins, the other gets 409 and its file is cleaned up.
- **Delete order.** The row is deleted first, then the file. If the second step fails you get a harmless orphan file. The other order could leave a row pointing at nothing.

## Tradeoffs

- **Signature checks are not validation.** They stop a renamed executable. They do not prove a PDF is well formed. The real parser in Milestone 4 must handle broken files, and DOCX files (zips) need a decompression-bomb guard there.
- **Memory storage for the upload.** The file is held in memory (10 MB cap) before it is hashed and written. Simple and safe at this size. Larger files would need streaming to disk.
- **Duplicates per workspace only.** A global check would tell a user that someone else already uploaded the file, which leaks information.
- **Local disk vs object storage.** Local disk is fine for one machine. Deployment needs a shared store, which is one new class behind `StorageService`.
- **Two size limits.** The API caps at `MAX_UPLOAD_MB`. The web proxy has its own buffer (10 MB by default). We raised it to 20 MB so files near the limit work and oversized ones get a clean 413. Above 20 MB the proxy still answers 500, which the UI never triggers because it checks the size first.

## Common mistakes

- Trusting the extension or the content type the browser sends.
- Using the uploaded file name in a path.
- Checking size after the whole file has been read into memory.
- Deleting the file before the database row, or writing the row before the file, without cleaning up on failure.
- Testing the API directly but not through the real front door. A file just over 10 MB gave 413 directly and 500 through the web proxy, and only a test through the proxy showed it.

## Interview questions

1. How do you decide what type an uploaded file is, and why not use its extension?
2. What can go wrong if you build a storage path from the user's file name?
3. Why hash uploaded files, and why should duplicate detection be per tenant?
4. Where do you enforce an upload size limit, and what happens at each layer?
5. What is the difference between checking a file signature and validating a file?

## Try it

Follow `docs/DEMO_GUIDE.md`, checks K to M. Then try your own bad files: rename a `.png` to `.pdf`, upload a `.docx` renamed to `.txt`, and upload the same file into two different workspaces.
