-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated

CREATE TABLE "ingestion_batches" (
  "id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "profile" VARCHAR(40) NOT NULL,
  "assignment_mode" VARCHAR(32) NOT NULL,
  "actor_id" VARCHAR(64) NOT NULL,
  "total_count" INTEGER NOT NULL,
  "created_count" INTEGER NOT NULL,
  "attached_count" INTEGER NOT NULL,
  "review_count" INTEGER NOT NULL,
  "invalid_count" INTEGER NOT NULL,
  "imported_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ingestion_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lead_provenances" (
  "id" UUID NOT NULL,
  "lead_id" UUID NOT NULL,
  "batch_id" UUID NOT NULL,
  "source_type" VARCHAR(40) NOT NULL,
  "technical_system" VARCHAR(80) NOT NULL,
  "original_source" VARCHAR(120) NOT NULL,
  "recent_source" VARCHAR(120) NOT NULL,
  "campaign" VARCHAR(120),
  "external_id" VARCHAR(160),
  "raw_status" VARCHAR(120),
  "occurred_at" TIMESTAMPTZ(6),
  "imported_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_provenances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lead_provenances_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id"),
  CONSTRAINT "lead_provenances_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "ingestion_batches"("id")
);

CREATE TABLE "ingestion_review_items" (
  "id" UUID NOT NULL,
  "batch_id" UUID NOT NULL,
  "lead_id" UUID,
  "line_number" INTEGER NOT NULL,
  "reason_code" VARCHAR(80) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ingestion_review_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ingestion_review_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "ingestion_batches"("id"),
  CONSTRAINT "ingestion_review_items_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id")
);

CREATE UNIQUE INDEX "ingestion_batches_idempotency_key_key" ON "ingestion_batches"("idempotency_key");
CREATE INDEX "ingestion_batches_imported_at_idx" ON "ingestion_batches"("imported_at" DESC);
CREATE UNIQUE INDEX "lead_provenances_technical_system_external_id_key" ON "lead_provenances"("technical_system", "external_id");
CREATE INDEX "lead_provenances_lead_id_imported_at_idx" ON "lead_provenances"("lead_id", "imported_at" DESC);
CREATE INDEX "lead_provenances_batch_id_idx" ON "lead_provenances"("batch_id");
CREATE UNIQUE INDEX "ingestion_review_items_batch_id_line_number_key" ON "ingestion_review_items"("batch_id", "line_number");
CREATE INDEX "ingestion_review_items_status_created_at_idx" ON "ingestion_review_items"("status", "created_at");
