-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated
-- No backfill: existing LOCAL_ROW streams/rows remain legacy, never rebased.
ALTER TABLE "sheet_local_streams" ADD COLUMN "append_contract" JSONB;
ALTER TABLE "sheet_local_streams" ADD COLUMN "append_qualification" JSONB;
ALTER TABLE "sheet_local_streams" ADD COLUMN "append_last_durable_row" INTEGER;
ALTER TABLE "sheet_local_rows" ADD COLUMN "append_payload" JSONB;
ALTER TABLE "sheet_local_rows" ADD COLUMN "append_occurrence_key" VARCHAR(64);
CREATE UNIQUE INDEX "sheet_local_rows_append_occurrence_key_key" ON "sheet_local_rows"("append_occurrence_key");
CREATE TABLE "sheet_append_observations" (
  "id" UUID NOT NULL PRIMARY KEY,
  "stream_id" VARCHAR(64) NOT NULL,
  "occurrence_key" VARCHAR(64) NOT NULL,
  "row_number" INTEGER NOT NULL CHECK ("row_number" >= 2),
  "fingerprint" VARCHAR(64) NOT NULL,
  "payload" JSONB NOT NULL,
  "observed_at" TIMESTAMPTZ(6) NOT NULL,
  "run_id" UUID NOT NULL,
  CONSTRAINT "sheet_append_observations_stream_id_fkey" FOREIGN KEY ("stream_id") REFERENCES "sheet_local_streams"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sheet_append_observations_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "sheet_import_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sheet_append_observations_identity_key" UNIQUE ("stream_id","occurrence_key","fingerprint")
);
CREATE INDEX "sheet_append_observations_stream_row_idx" ON "sheet_append_observations"("stream_id","row_number");
