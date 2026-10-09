-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated
-- New empty ledgers; synthetic qualification exercises all unique bindings and receipt keys.
CREATE TABLE "import_cutover_manifests" (
  "id" UUID NOT NULL,
  "campus_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "bootstrap_package_id" UUID NOT NULL,
  "connector_id" UUID NOT NULL,
  "state" VARCHAR(24) NOT NULL DEFAULT 'DRAFT' CHECK ("state" IN ('DRAFT','BASELINED','READY_FOR_CATCHUP','SUSPENDED')),
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "contract" JSONB NOT NULL,
  "inventory" JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof("inventory") = 'array' AND jsonb_array_length("inventory") <= 10000),
  "header_sha256" VARCHAR(64),
  "snapshot_sha256" VARCHAR(64),
  "observed_at" TIMESTAMPTZ(6),
  "source_count" INTEGER NOT NULL DEFAULT 0 CHECK ("source_count" >= 0 AND "source_count" <= 10000),
  "report_sha256" VARCHAR(64),
  "suspension_reason" VARCHAR(500),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_cutover_manifests_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "import_cutover_receipts" (
  "id" UUID NOT NULL,
  "manifest_id" UUID NOT NULL,
  "operation" VARCHAR(24) NOT NULL,
  "key" VARCHAR(128) NOT NULL,
  "fingerprint" VARCHAR(64) NOT NULL,
  "actor_id" UUID NOT NULL,
  "response" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_cutover_receipts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "import_cutover_manifests_bootstrap_package_id_key" ON "import_cutover_manifests"("bootstrap_package_id");
CREATE UNIQUE INDEX "import_cutover_manifests_connector_id_key" ON "import_cutover_manifests"("connector_id");
CREATE INDEX "import_cutover_manifests_campus_id_created_at_idx" ON "import_cutover_manifests"("campus_id","created_at");
CREATE UNIQUE INDEX "import_cutover_receipts_manifest_id_operation_key_key" ON "import_cutover_receipts"("manifest_id","operation","key");
ALTER TABLE "import_cutover_manifests" ADD CONSTRAINT "import_cutover_manifests_bootstrap_package_id_fkey" FOREIGN KEY ("bootstrap_package_id") REFERENCES "bootstrap_import_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "import_cutover_manifests" ADD CONSTRAINT "import_cutover_manifests_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "sheet_import_connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "import_cutover_receipts" ADD CONSTRAINT "import_cutover_receipts_manifest_id_fkey" FOREIGN KEY ("manifest_id") REFERENCES "import_cutover_manifests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
