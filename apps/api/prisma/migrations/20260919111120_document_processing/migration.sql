-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "char_count" INTEGER,
ADD COLUMN     "page_count" INTEGER,
ADD COLUMN     "processed_at" TIMESTAMP(3),
ADD COLUMN     "processing_started_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "document_pages" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "page_number" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "char_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_pages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_pages_workspace_id_document_id_idx" ON "document_pages"("workspace_id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_pages_document_id_page_number_key" ON "document_pages"("document_id", "page_number");

-- AddForeignKey
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
