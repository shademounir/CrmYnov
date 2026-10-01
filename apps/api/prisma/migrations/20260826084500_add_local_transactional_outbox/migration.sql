-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated

CREATE TABLE "local_outbox_events" (
  "id" UUID NOT NULL,
  "topic" VARCHAR(80) NOT NULL,
  "aggregate_type" VARCHAR(48) NOT NULL,
  "aggregate_id" VARCHAR(80) NOT NULL,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "payload" JSONB NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMPTZ(6),
  "locked_by" VARCHAR(80),
  "delivered_at" TIMESTAMPTZ(6),
  "last_error_code" VARCHAR(80),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "local_outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "local_outbox_events_idempotency_key_key" ON "local_outbox_events"("idempotency_key");
CREATE INDEX "local_outbox_events_status_available_at_created_at_idx" ON "local_outbox_events"("status", "available_at", "created_at");
CREATE INDEX "local_outbox_events_aggregate_type_aggregate_id_created_at_idx" ON "local_outbox_events"("aggregate_type", "aggregate_id", "created_at");
CREATE INDEX "local_outbox_events_locked_at_idx" ON "local_outbox_events"("locked_at");
