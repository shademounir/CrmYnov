-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- No historical backfill: an absent fingerprint requires controlled reconciliation.
ALTER TABLE "lead_provenances" ADD COLUMN "submission_fingerprint" VARCHAR(64);
