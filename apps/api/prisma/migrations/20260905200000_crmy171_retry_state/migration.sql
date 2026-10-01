-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
ALTER TABLE "sheet_import_runs" ADD COLUMN "source_failures" INTEGER NOT NULL DEFAULT 0 CHECK ("source_failures" >= 0);
