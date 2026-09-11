-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated
-- Additive: existing runs are deliberately not assigned an invented mapping snapshot.
ALTER TABLE "sheet_import_runs"
  ADD COLUMN "configuration_snapshot" JSONB,
  ADD COLUMN "configuration_version" INTEGER;

CREATE TABLE "sheet_import_configuration_versions" (
  "id" UUID NOT NULL,
  "connector_id" UUID NOT NULL,
  "version" INTEGER NOT NULL CHECK ("version" > 0),
  "snapshot" JSONB NOT NULL,
  "actor_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sheet_import_configuration_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sheet_import_configuration_versions_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "sheet_import_connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "sheet_import_configuration_versions_connector_id_version_key" ON "sheet_import_configuration_versions"("connector_id", "version");

CREATE TABLE "sheet_import_run_receipts" (
  "id" UUID NOT NULL,
  "run_id" UUID NOT NULL,
  "row_key" VARCHAR(64) NOT NULL,
  "outcome" VARCHAR(24) NOT NULL,
  "error_code" VARCHAR(80),
  "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sheet_import_run_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sheet_import_run_receipts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "sheet_import_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "sheet_import_run_receipts_run_id_row_key_key" ON "sheet_import_run_receipts"("run_id", "row_key");
