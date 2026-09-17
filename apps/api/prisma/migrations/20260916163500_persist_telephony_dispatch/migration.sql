-- prisma-policy: additive
-- prisma-policy: rollback-documented
-- Existing calls predate the bridge dispatch contract and remain accepted evidence.
ALTER TABLE "telephony_calls"
  ADD COLUMN "dispatch_state" CHARACTER VARYING(16) NOT NULL DEFAULT 'ACCEPTED',
  ADD COLUMN "dispatch_error_code" CHARACTER VARYING(64),
  ADD COLUMN "dispatch_updated_at" TIMESTAMPTZ(6);
