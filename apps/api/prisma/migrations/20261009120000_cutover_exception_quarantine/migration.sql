-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated
-- Nullable: historical observations are not backfilled or asserted as true reads.
ALTER TABLE "import_cutover_manifests" ADD COLUMN "exception_observation" JSONB;
CREATE TABLE "import_cutover_exception_cases" (
  "id" UUID NOT NULL,
  "manifest_id" UUID NOT NULL,
  "source_key" VARCHAR(64) NOT NULL,
  "kind" VARCHAR(24) NOT NULL CHECK ("kind" IN ('SOURCE_CHANGED','SOURCE_REMOVED','EFFECT_REVIEW')),
  "generation" INTEGER NOT NULL CHECK ("generation" > 0),
  "evidence_sha256" VARCHAR(64) NOT NULL,
  "evidence" JSONB NOT NULL,
  "observed_payload" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_cutover_exception_cases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "import_cutover_exception_cases_manifest_fkey" FOREIGN KEY ("manifest_id") REFERENCES "import_cutover_manifests"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "import_cutover_exception_cases_generation_key" ON "import_cutover_exception_cases"("manifest_id","source_key","kind","generation");
CREATE TABLE "import_cutover_exception_dispositions" (
  "id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "action" VARCHAR(24) NOT NULL CHECK ("action" = 'QUARANTINE_PRESERVE'),
  "evidence_sha256" VARCHAR(64) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "actor_id" UUID NOT NULL,
  "decided_manifest_version" INTEGER NOT NULL CHECK ("decided_manifest_version" > 0),
  "decided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_cutover_exception_dispositions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "import_cutover_exception_dispositions_case_fkey" FOREIGN KEY ("case_id") REFERENCES "import_cutover_exception_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "import_cutover_exception_dispositions_case_key" ON "import_cutover_exception_dispositions"("case_id");
