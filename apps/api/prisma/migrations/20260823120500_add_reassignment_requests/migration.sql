-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented

CREATE TABLE "reassignment_requests" (
  "id" UUID NOT NULL,
  "lead_id" UUID NOT NULL,
  "current_owner_id" UUID NOT NULL,
  "target_user_id" UUID NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "move_open_tasks" BOOLEAN NOT NULL,
  "requested_by" VARCHAR(64) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_by" VARCHAR(64),
  "decided_at" TIMESTAMPTZ(6),
  "decision_reason" VARCHAR(500),
  CONSTRAINT "reassignment_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reassignment_requests_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id")
);

CREATE INDEX "reassignment_requests_lead_id_requested_at_idx" ON "reassignment_requests"("lead_id", "requested_at" DESC);
CREATE INDEX "reassignment_requests_status_requested_at_idx" ON "reassignment_requests"("status", "requested_at");
