-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated
-- CRMY-171: additive connector configuration, fenced runs and stable submission receipts.
CREATE TABLE "sheet_import_connectors" (
  "id" UUID NOT NULL,
  "campus_id" UUID NOT NULL,
  "workbook_id" VARCHAR(200) NOT NULL,
  "tab" VARCHAR(100) NOT NULL,
  "configuration" JSONB NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "interval_minutes" INTEGER NOT NULL DEFAULT 15 CHECK ("interval_minutes" BETWEEN 5 AND 15),
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "epoch" INTEGER NOT NULL DEFAULT 0 CHECK ("epoch" >= 0),
  "lease_until" TIMESTAMPTZ(6),
  "active_run_id" UUID,
  "next_run_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "sheet_import_connectors_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sheet_import_connectors_workbook_id_tab_key" ON "sheet_import_connectors"("workbook_id", "tab");
CREATE INDEX "sheet_import_connectors_enabled_next_run_at_idx" ON "sheet_import_connectors"("enabled", "next_run_at");
CREATE TABLE "sheet_import_runs" (
  "id" UUID NOT NULL,
  "connector_id" UUID NOT NULL,
  "status" VARCHAR(24) NOT NULL,
  "trigger" VARCHAR(16) NOT NULL,
  "created_count" INTEGER NOT NULL DEFAULT 0,
  "duplicate_count" INTEGER NOT NULL DEFAULT 0,
  "ignored_count" INTEGER NOT NULL DEFAULT 0,
  "review_count" INTEGER NOT NULL DEFAULT 0,
  "error_code" VARCHAR(80),
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "sheet_import_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sheet_import_runs_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "sheet_import_connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "sheet_import_runs_connector_id_started_at_idx" ON "sheet_import_runs"("connector_id", "started_at" DESC);
CREATE TABLE "sheet_import_submissions" (
  "id" UUID NOT NULL,
  "connector_id" UUID NOT NULL,
  "external_id" VARCHAR(128) NOT NULL,
  "fingerprint" VARCHAR(64) NOT NULL,
  "outcome" VARCHAR(24) NOT NULL,
  "batch_id" UUID,
  "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sheet_import_submissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sheet_import_submissions_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "sheet_import_connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "sheet_import_submissions_connector_id_external_id_key" ON "sheet_import_submissions"("connector_id", "external_id");
