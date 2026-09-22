-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated
-- Append-only versions are unique per Lead; idempotency keys are unique across requests.
CREATE TABLE "lead_commercial_qualifications" (
  "id" UUID NOT NULL,
  "lead_id" UUID NOT NULL,
  "temperature" VARCHAR(16) NOT NULL,
  "reason" VARCHAR(240) NOT NULL,
  "comment" VARCHAR(1000),
  "author_id" VARCHAR(64) NOT NULL,
  "version" INTEGER NOT NULL CHECK ("version" > 0),
  "idempotency_key" VARCHAR(128) NOT NULL,
  "fingerprint" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_commercial_qualifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lead_commercial_qualifications_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "lead_commercial_qualifications_temperature_check" CHECK ("temperature" IN ('COLD', 'WARM', 'HOT'))
);

CREATE UNIQUE INDEX "lead_commercial_qualifications_lead_id_version_key"
  ON "lead_commercial_qualifications"("lead_id", "version");

CREATE UNIQUE INDEX "lead_commercial_qualifications_idempotency_key_key"
  ON "lead_commercial_qualifications"("idempotency_key");

CREATE INDEX "lead_commercial_qualifications_lead_id_created_at_id_idx"
  ON "lead_commercial_qualifications"("lead_id", "created_at" DESC, "id");

CREATE INDEX "lead_commercial_qualifications_temperature_created_at_idx"
  ON "lead_commercial_qualifications"("temperature", "created_at" DESC);
