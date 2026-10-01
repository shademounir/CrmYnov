-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented

ALTER TABLE "collaborators" ADD COLUMN "first_login_required" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "collaborators" ADD COLUMN "authentication_version" INTEGER NOT NULL DEFAULT 1;
