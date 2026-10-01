-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- Existing audit evidence is never rewritten or assigned a guessed campus.
ALTER TABLE "audit_events" ADD COLUMN "campus_id" VARCHAR(64);
ALTER TABLE "audit_events" ADD COLUMN "resource_type" VARCHAR(40);
ALTER TABLE "audit_events" ADD COLUMN "resource_id" VARCHAR(64);
CREATE INDEX "audit_events_campus_id_occurred_at_id_idx" ON "audit_events"("campus_id", "occurred_at" DESC, "id");
CREATE INDEX "audit_events_resource_id_occurred_at_idx" ON "audit_events"("resource_id", "occurred_at" DESC);
