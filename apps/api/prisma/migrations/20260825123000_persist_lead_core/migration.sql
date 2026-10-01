-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated

ALTER TABLE "leads"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "lead_activities"
  ADD COLUMN "idempotency_key" VARCHAR(160),
  ADD COLUMN "original_event_id" UUID,
  ADD COLUMN "correction_operation" VARCHAR(16),
  ADD COLUMN "correction_reason_code" VARCHAR(80),
  ADD COLUMN "previous_snapshot" JSONB,
  ADD COLUMN "replacement_snapshot" JSONB;

CREATE UNIQUE INDEX "lead_activities_idempotency_key_key"
  ON "lead_activities"("idempotency_key");

ALTER TABLE "reassignment_requests"
  ADD COLUMN "idempotency_key" VARCHAR(128),
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX "reassignment_requests_idempotency_key_key"
  ON "reassignment_requests"("idempotency_key");

CREATE TABLE "lead_collaboration_requests" (
  "id" UUID NOT NULL,
  "lead_id" UUID NOT NULL,
  "target_user_id" UUID NOT NULL,
  "action" VARCHAR(16) NOT NULL,
  "role" VARCHAR(40) NOT NULL,
  "justification" VARCHAR(500) NOT NULL,
  "requester_id" VARCHAR(64) NOT NULL,
  "state" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_at" TIMESTAMPTZ(6),
  "decided_by" VARCHAR(64),
  "decision_reason" VARCHAR(500),
  CONSTRAINT "lead_collaboration_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lead_collaboration_requests_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id")
);

CREATE INDEX "lead_collaboration_requests_lead_id_created_at_idx"
  ON "lead_collaboration_requests"("lead_id", "created_at" DESC);
CREATE INDEX "lead_collaboration_requests_state_created_at_idx"
  ON "lead_collaboration_requests"("state", "created_at");

CREATE TABLE "lead_closure_requests" (
  "id" UUID NOT NULL,
  "lead_id" UUID NOT NULL,
  "target" VARCHAR(24) NOT NULL,
  "reason" VARCHAR(80) NOT NULL,
  "comment" VARCHAR(1000) NOT NULL,
  "evidence" TEXT[] NOT NULL,
  "requester_id" VARCHAR(64) NOT NULL,
  "state" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_at" TIMESTAMPTZ(6),
  "decided_by" VARCHAR(64),
  "decision_reason" VARCHAR(500),
  CONSTRAINT "lead_closure_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lead_closure_requests_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id")
);

CREATE INDEX "lead_closure_requests_lead_id_created_at_idx"
  ON "lead_closure_requests"("lead_id", "created_at" DESC);
CREATE INDEX "lead_closure_requests_state_created_at_idx"
  ON "lead_closure_requests"("state", "created_at");

CREATE TABLE "lead_mutation_receipts" (
  "id" UUID NOT NULL,
  "lead_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "fingerprint" VARCHAR(64) NOT NULL,
  "operation" VARCHAR(48) NOT NULL,
  "result" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_mutation_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lead_mutation_receipts_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id")
);

CREATE UNIQUE INDEX "lead_mutation_receipts_idempotency_key_key"
  ON "lead_mutation_receipts"("idempotency_key");
CREATE INDEX "lead_mutation_receipts_lead_id_created_at_idx"
  ON "lead_mutation_receipts"("lead_id", "created_at" DESC);
