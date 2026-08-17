-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented

ALTER TABLE "collaborators" ADD COLUMN "must_change_secret" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "collaborators" ADD COLUMN "credential_version" INTEGER NOT NULL DEFAULT 1;
