-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated
-- One runtime per existing manifest. No backfill, existing history or Lead is changed.
CREATE TABLE "import_cutover_runtimes" (
  "manifest_id" UUID NOT NULL PRIMARY KEY,
  "version" INTEGER NOT NULL DEFAULT 1,
  "state" VARCHAR(16) NOT NULL CHECK ("state" IN ('PREPARED','ARMED','PAUSED')),
  "qualification" JSONB NOT NULL,
  "delegation" JSONB,
  "epoch" INTEGER NOT NULL DEFAULT 0,
  "lease_owner" UUID,
  "lease_until" TIMESTAMPTZ(6),
  "lease_manifest_version" INTEGER,
  "active_run_id" UUID,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_cutover_runtimes_manifest_id_fkey" FOREIGN KEY ("manifest_id") REFERENCES "import_cutover_manifests"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "import_cutover_runtime_runs" (
  "id" UUID NOT NULL PRIMARY KEY,
  "manifest_id" UUID NOT NULL,
  "epoch" INTEGER NOT NULL,
  "status" VARCHAR(16) NOT NULL CHECK ("status" IN ('RUNNING','COMPLETED','FAILED','BLOCKED','ABANDONED')),
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(6),
  "error_code" VARCHAR(128),
  CONSTRAINT "import_cutover_runtime_runs_manifest_id_fkey" FOREIGN KEY ("manifest_id") REFERENCES "import_cutover_runtimes"("manifest_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "import_cutover_runtime_runs_epoch_key" UNIQUE ("manifest_id","epoch")
);
CREATE TABLE "import_cutover_runtime_receipts" (
  "id" UUID NOT NULL PRIMARY KEY,
  "manifest_id" UUID NOT NULL,
  "operation" VARCHAR(24) NOT NULL,
  "key" VARCHAR(128) NOT NULL,
  "fingerprint" VARCHAR(64) NOT NULL,
  "actor_id" VARCHAR(64) NOT NULL,
  "response" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_cutover_runtime_receipts_manifest_id_fkey" FOREIGN KEY ("manifest_id") REFERENCES "import_cutover_runtimes"("manifest_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "import_cutover_runtime_receipts_request_key" UNIQUE ("manifest_id","operation","key")
);
