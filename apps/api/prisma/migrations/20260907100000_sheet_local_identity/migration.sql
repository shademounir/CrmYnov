-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- Rollback: disable the new mode and roll back the application; preserve tables and histories.
CREATE TABLE "sheet_local_streams" (
  "id" VARCHAR(64) NOT NULL PRIMARY KEY,
  "workbook_id" VARCHAR(200) NOT NULL,
  "sheet_id" INTEGER NOT NULL CHECK ("sheet_id" >= 0),
  "campus_id" UUID NOT NULL,
  "range" VARCHAR(64) NOT NULL,
  "header_fingerprint" VARCHAR(64) NOT NULL,
  "suspended" BOOLEAN NOT NULL DEFAULT false,
  "error_code" VARCHAR(80),
  "last_observed_row" INTEGER NOT NULL CHECK ("last_observed_row" >= 1),
  CONSTRAINT "sheet_local_streams_workbook_id_sheet_id_key" UNIQUE ("workbook_id", "sheet_id")
);
CREATE TABLE "sheet_local_rows" (
  "id" UUID NOT NULL PRIMARY KEY,
  "stream_id" VARCHAR(64) NOT NULL,
  "row_number" INTEGER NOT NULL CHECK ("row_number" >= 2),
  "fingerprint" VARCHAR(64) NOT NULL,
  "status" VARCHAR(24) NOT NULL,
  "error_code" VARCHAR(80),
  "batch_id" UUID,
  "first_observed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_observed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sheet_local_rows_stream_id_row_number_key" UNIQUE ("stream_id", "row_number"),
  CONSTRAINT "sheet_local_rows_stream_id_fkey" FOREIGN KEY ("stream_id") REFERENCES "sheet_local_streams"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
