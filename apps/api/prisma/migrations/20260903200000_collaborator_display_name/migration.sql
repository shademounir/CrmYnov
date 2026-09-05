-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
ALTER TABLE "collaborators" ADD COLUMN "professional_display_name" VARCHAR(120);
