-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated

CREATE TABLE "assignment_batches" (
  "id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "strategy" VARCHAR(32) NOT NULL,
  "target_user_id" UUID,
  "actor_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assignment_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "assignment_batch_items" (
  "id" UUID NOT NULL,
  "batch_id" UUID NOT NULL,
  "lead_id" UUID NOT NULL,
  "selected_user_id" UUID,
  "outcome" VARCHAR(16) NOT NULL,
  "reason" VARCHAR(80),
  CONSTRAINT "assignment_batch_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assignment_batch_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "assignment_batches"("id"),
  CONSTRAINT "assignment_batch_items_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id")
);

CREATE UNIQUE INDEX "assignment_batches_idempotency_key_key" ON "assignment_batches"("idempotency_key");
CREATE INDEX "assignment_batches_created_at_idx" ON "assignment_batches"("created_at" DESC);
CREATE UNIQUE INDEX "assignment_batch_items_batch_id_lead_id_key" ON "assignment_batch_items"("batch_id", "lead_id");
CREATE INDEX "assignment_batch_items_lead_id_idx" ON "assignment_batch_items"("lead_id");
