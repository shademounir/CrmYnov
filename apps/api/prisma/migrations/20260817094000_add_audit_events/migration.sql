-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated

CREATE TABLE "audit_events" (
  "id" UUID NOT NULL,
  "event_type" VARCHAR(80) NOT NULL,
  "actor_id" VARCHAR(64),
  "actor_roles" TEXT[] NOT NULL,
  "minimized_ip" VARCHAR(64),
  "session_id" UUID,
  "correlation_id" VARCHAR(64) NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "result" VARCHAR(32) NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "audit_events_idempotency_key_key" ON "audit_events"("idempotency_key");
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events"("occurred_at" DESC);
CREATE INDEX "audit_events_actor_id_occurred_at_idx" ON "audit_events"("actor_id", "occurred_at" DESC);
