-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated

CREATE TABLE "import_reports" (
  "id" UUID NOT NULL,
  "job_id" VARCHAR(128) NOT NULL,
  "batch_id" UUID NOT NULL,
  "mapping_id" VARCHAR(80) NOT NULL,
  "mapping_version" INTEGER NOT NULL,
  "source_file_sha256" CHAR(64) NOT NULL,
  "total_count" INTEGER NOT NULL,
  "created_count" INTEGER NOT NULL,
  "updated_count" INTEGER NOT NULL,
  "ignored_count" INTEGER NOT NULL,
  "duplicate_count" INTEGER NOT NULL,
  "error_count" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "import_reports_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "ingestion_batches"("id")
);

CREATE UNIQUE INDEX "import_reports_job_id_key" ON "import_reports"("job_id");
CREATE UNIQUE INDEX "import_reports_batch_id_key" ON "import_reports"("batch_id");
CREATE INDEX "import_reports_created_at_idx" ON "import_reports"("created_at" DESC);

CREATE TABLE "import_rejections" (
  "id" UUID NOT NULL,
  "report_id" UUID NOT NULL,
  "line_number" INTEGER NOT NULL,
  "category" VARCHAR(32) NOT NULL,
  "reason_code" VARCHAR(80) NOT NULL,
  CONSTRAINT "import_rejections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "import_rejections_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "import_reports"("id")
);

CREATE UNIQUE INDEX "import_rejections_report_id_line_number_key" ON "import_rejections"("report_id", "line_number");
