-- CreateTable
CREATE TABLE "eval_runs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "label" TEXT,
    "strategy" TEXT NOT NULL,
    "setup_id" TEXT NOT NULL,
    "retrieval" TEXT NOT NULL,
    "k" INTEGER NOT NULL,
    "question_set" TEXT NOT NULL,
    "question_file_hash" TEXT NOT NULL,
    "question_count" INTEGER NOT NULL,
    "answerable_count" INTEGER NOT NULL,
    "hit_rate_1" DOUBLE PRECISION NOT NULL,
    "hit_rate_3" DOUBLE PRECISION NOT NULL,
    "hit_rate_5" DOUBLE PRECISION NOT NULL,
    "mrr" DOUBLE PRECISION NOT NULL,
    "config" JSONB NOT NULL,
    "results" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eval_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "eval_runs_workspace_id_created_at_idx" ON "eval_runs"("workspace_id", "created_at");

-- AddForeignKey
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
