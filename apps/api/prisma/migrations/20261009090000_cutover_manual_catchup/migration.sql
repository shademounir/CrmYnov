-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated
-- Nullable binding preserves v1 preparation ledgers; only new v2 manifests can consume.
ALTER TABLE "import_cutover_manifests" ADD COLUMN "stream_key" VARCHAR(64);
CREATE UNIQUE INDEX "import_cutover_manifests_stream_key_key" ON "import_cutover_manifests"("stream_key");
CREATE TABLE "import_cutover_effects" (
  "id" UUID NOT NULL,
  "manifest_id" UUID NOT NULL,
  "source_key" VARCHAR(64) NOT NULL,
  "outcome" VARCHAR(24) NOT NULL CHECK ("outcome" IN ('CREATED','LINKED_BASELINE','REVIEW')),
  "batch_id" UUID,
  "lead_id" UUID,
  "reason" VARCHAR(128),
  "downstream_sha256" VARCHAR(64),
  "compensation_status" VARCHAR(32) CHECK ("compensation_status" IN ('REQUESTED','BLOCKED_DOWNSTREAM')),
  "compensation_reason" VARCHAR(500),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "compared_at" TIMESTAMPTZ(6),
  CONSTRAINT "import_cutover_effects_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "import_cutover_effects_manifest_id_fkey" FOREIGN KEY ("manifest_id") REFERENCES "import_cutover_manifests"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "import_cutover_effects_manifest_id_source_key_key" ON "import_cutover_effects"("manifest_id","source_key");
