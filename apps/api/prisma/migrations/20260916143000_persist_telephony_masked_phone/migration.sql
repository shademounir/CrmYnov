-- prisma-policy: additive
-- prisma-policy: rollback-documented
-- The suffix is already masked by the application; no raw phone is stored.
ALTER TABLE "telephony_calls"
  ADD COLUMN "masked_phone" CHARACTER VARYING(8) NOT NULL DEFAULT '***';
