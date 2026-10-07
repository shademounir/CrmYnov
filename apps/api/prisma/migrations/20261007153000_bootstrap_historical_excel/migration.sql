-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated
-- Empty new ledgers have no pre-existing identities; verify constraints using isolated synthetic fixtures.
-- AlterTable
ALTER TABLE "leads" ADD COLUMN "acquisition_kind" VARCHAR(16) NOT NULL DEFAULT 'NEW' CHECK ("acquisition_kind" IN ('NEW', 'BASELINE'));
ALTER TABLE "leads" ADD COLUMN "baseline_temperature" VARCHAR(16) CHECK ("baseline_temperature" IN ('UNEVALUATED', 'COLD', 'WARM', 'HOT'));

-- CreateTable
CREATE TABLE "bootstrap_import_packages" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "file_name" VARCHAR(180) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "state" VARCHAR(24) NOT NULL DEFAULT 'UPLOADING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "snapshot" JSONB,
    "batch_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sealed_at" TIMESTAMPTZ(6),

    CONSTRAINT "bootstrap_import_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bootstrap_import_chunks" (
    "package_id" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "bytes" BYTEA NOT NULL,

    CONSTRAINT "bootstrap_import_chunks_pkey" PRIMARY KEY ("package_id","index")
);

-- CreateTable
CREATE TABLE "bootstrap_import_plans" (
    "id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "mapping_version" VARCHAR(64) NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "configuration" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bootstrap_import_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bootstrap_import_rows" (
    "id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "sheet" VARCHAR(80) NOT NULL,
    "relation_id" VARCHAR(80) NOT NULL,
    "row_number" INTEGER NOT NULL,
    "source_key" VARCHAR(64) NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "mapped" JSONB NOT NULL,
    "reasons" TEXT[],
    "state" VARCHAR(24) NOT NULL DEFAULT 'REVIEW',
    "version" INTEGER NOT NULL DEFAULT 1,
    "decision" JSONB,
    "decision_key" VARCHAR(128),
    "decision_fingerprint" VARCHAR(64),
    "lead_id" UUID,

    CONSTRAINT "bootstrap_import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bootstrap_import_receipts" (
    "id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "operation" VARCHAR(24) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "response" JSONB NOT NULL,
    "actor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bootstrap_import_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imported_historical_notes" (
    "id" UUID NOT NULL,
    "row_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "cell_key" VARCHAR(64) NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "source_sheet" VARCHAR(80) NOT NULL,
    "source_row" INTEGER NOT NULL,
    "source_column" VARCHAR(4) NOT NULL,
    "text" TEXT NOT NULL,
    "source_value" JSONB NOT NULL,
    "author" VARCHAR(120),
    "occurred_at" TIMESTAMPTZ(6),
    "imported_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imported_historical_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bootstrap_import_packages_sha256_key" ON "bootstrap_import_packages"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "bootstrap_import_packages_batch_id_key" ON "bootstrap_import_packages"("batch_id");

-- CreateIndex
CREATE INDEX "bootstrap_import_packages_campus_id_created_at_idx" ON "bootstrap_import_packages"("campus_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "bootstrap_import_packages_actor_id_key_key" ON "bootstrap_import_packages"("actor_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "bootstrap_import_plans_package_id_version_key" ON "bootstrap_import_plans"("package_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "bootstrap_import_rows_source_key_key" ON "bootstrap_import_rows"("source_key");

-- CreateIndex
CREATE INDEX "bootstrap_import_rows_package_id_state_sheet_row_number_idx" ON "bootstrap_import_rows"("package_id", "state", "sheet", "row_number");

-- CreateIndex
CREATE UNIQUE INDEX "bootstrap_import_rows_package_id_relation_id_row_number_key" ON "bootstrap_import_rows"("package_id", "relation_id", "row_number");

-- CreateIndex
CREATE UNIQUE INDEX "bootstrap_import_rows_package_id_decision_key_key" ON "bootstrap_import_rows"("package_id", "decision_key");

-- CreateIndex
CREATE UNIQUE INDEX "bootstrap_import_receipts_package_id_operation_key_key" ON "bootstrap_import_receipts"("package_id", "operation", "key");

-- CreateIndex
CREATE UNIQUE INDEX "imported_historical_notes_cell_key_key" ON "imported_historical_notes"("cell_key");

-- CreateIndex
CREATE INDEX "imported_historical_notes_lead_id_source_sheet_source_row_idx" ON "imported_historical_notes"("lead_id", "source_sheet", "source_row");

-- AddForeignKey
ALTER TABLE "bootstrap_import_packages" ADD CONSTRAINT "bootstrap_import_packages_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "ingestion_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bootstrap_import_chunks" ADD CONSTRAINT "bootstrap_import_chunks_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "bootstrap_import_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bootstrap_import_plans" ADD CONSTRAINT "bootstrap_import_plans_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "bootstrap_import_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bootstrap_import_rows" ADD CONSTRAINT "bootstrap_import_rows_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "bootstrap_import_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bootstrap_import_rows" ADD CONSTRAINT "bootstrap_import_rows_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "bootstrap_import_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bootstrap_import_rows" ADD CONSTRAINT "bootstrap_import_rows_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bootstrap_import_receipts" ADD CONSTRAINT "bootstrap_import_receipts_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "bootstrap_import_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imported_historical_notes" ADD CONSTRAINT "imported_historical_notes_row_id_fkey" FOREIGN KEY ("row_id") REFERENCES "bootstrap_import_rows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imported_historical_notes" ADD CONSTRAINT "imported_historical_notes_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
