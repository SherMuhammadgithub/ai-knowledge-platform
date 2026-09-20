-- AlterEnum
ALTER TYPE "DocumentStatus" ADD VALUE 'INDEXING';

-- AlterTable
ALTER TABLE "document_chunks" ADD COLUMN     "embedded_with" TEXT;

-- CreateTable
CREATE TABLE "chunk_embeddings" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "setup_id" TEXT NOT NULL,
    "vector" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chunk_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chunk_embeddings_workspace_id_content_hash_setup_id_key" ON "chunk_embeddings"("workspace_id", "content_hash", "setup_id");

-- CreateIndex
CREATE INDEX "document_chunks_workspace_id_content_hash_idx" ON "document_chunks"("workspace_id", "content_hash");

-- AddForeignKey
ALTER TABLE "chunk_embeddings" ADD CONSTRAINT "chunk_embeddings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
