-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('PDF', 'DOCX', 'TXT');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "uploaded_by_id" TEXT,
    "original_name" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "status_detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documents_workspace_id_created_at_idx" ON "documents"("workspace_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "documents_workspace_id_content_hash_key" ON "documents"("workspace_id", "content_hash");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
