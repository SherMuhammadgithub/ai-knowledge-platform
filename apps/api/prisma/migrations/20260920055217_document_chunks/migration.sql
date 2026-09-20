-- CreateTable
CREATE TABLE "document_chunks" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "page_number" INTEGER NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "strategy" TEXT NOT NULL,
    "start_char" INTEGER NOT NULL,
    "end_char" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "token_estimate" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_chunks_workspace_id_document_id_idx" ON "document_chunks"("workspace_id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_chunks_document_id_strategy_chunk_index_key" ON "document_chunks"("document_id", "strategy", "chunk_index");

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
