-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated
-- One active follow-up is serialized by the transaction predicate; receipts make exact retries immutable.
CREATE TABLE "lead_follow_ups" (
  "id" UUID NOT NULL,
  "lead_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "due_at" TIMESTAMPTZ(6) NOT NULL,
  "state" CHARACTER VARYING(16) NOT NULL,
  "reason" CHARACTER VARYING(1000) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "idempotency_key" CHARACTER VARYING(128) NOT NULL,
  "fingerprint" CHARACTER VARYING(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "lead_follow_ups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lead_follow_ups_state_check" CHECK ("state" IN ('SCHEDULED', 'DUE', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT "lead_follow_ups_version_check" CHECK ("version" >= 1),
  CONSTRAINT "lead_follow_ups_due_after_creation_check" CHECK ("due_at" > "created_at"),
  CONSTRAINT "lead_follow_ups_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "lead_follow_ups_idempotency_key_key" ON "lead_follow_ups"("idempotency_key");
CREATE INDEX "lead_follow_ups_lead_id_state_due_at_idx" ON "lead_follow_ups"("lead_id", "state", "due_at");
CREATE INDEX "lead_follow_ups_owner_id_state_due_at_idx" ON "lead_follow_ups"("owner_id", "state", "due_at");

CREATE TABLE "lead_follow_up_mutation_receipts" (
  "idempotency_key" CHARACTER VARYING(128) NOT NULL,
  "follow_up_id" UUID NOT NULL,
  "fingerprint" CHARACTER VARYING(64) NOT NULL,
  "result" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_follow_up_mutation_receipts_pkey" PRIMARY KEY ("idempotency_key"),
  CONSTRAINT "lead_follow_up_mutation_receipts_follow_up_id_fkey" FOREIGN KEY ("follow_up_id") REFERENCES "lead_follow_ups"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "lead_follow_up_mutation_receipts_follow_up_id_created_at_idx"
  ON "lead_follow_up_mutation_receipts"("follow_up_id", "created_at" DESC);
