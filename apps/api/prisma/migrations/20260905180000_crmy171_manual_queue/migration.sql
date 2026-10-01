-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
ALTER TABLE "sheet_import_connectors" ADD COLUMN "manual_requested" BOOLEAN NOT NULL DEFAULT false;
