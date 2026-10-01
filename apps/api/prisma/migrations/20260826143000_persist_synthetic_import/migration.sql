-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented

ALTER TABLE "ingestion_batches"
  ADD COLUMN "fingerprint" VARCHAR(64) NOT NULL DEFAULT 'legacy-unverified';
