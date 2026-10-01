-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated
-- Empty technical serialization table, no business data migration.
CREATE TABLE "role_permission_epoch" (
  "id" INTEGER NOT NULL,
  "version" BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT "role_permission_epoch_pkey" PRIMARY KEY ("id")
);
