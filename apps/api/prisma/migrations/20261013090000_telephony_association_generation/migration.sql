-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
ALTER TABLE "telephony_workstations" ADD COLUMN "association_id" UUID;
