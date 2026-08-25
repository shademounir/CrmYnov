-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated
CREATE TABLE "appointments" (
  "id" UUID NOT NULL, "lead_id" UUID NOT NULL, "type" VARCHAR(40) NOT NULL, "mode" VARCHAR(32) NOT NULL,
  "state" VARCHAR(24) NOT NULL DEFAULT 'BROUILLON', "starts_at" TIMESTAMPTZ(6) NOT NULL, "duration_minutes" INTEGER NOT NULL,
  "timezone" VARCHAR(40) NOT NULL DEFAULT 'Africa/Casablanca', "campus" VARCHAR(120), "adviser_id" VARCHAR(64) NOT NULL,
  "organizer_id" VARCHAR(64) NOT NULL, "evaluator_id" VARCHAR(64), "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "appointment_participants" (
  "id" UUID NOT NULL, "appointment_id" UUID NOT NULL, "user_id" VARCHAR(64) NOT NULL, "role" VARCHAR(24) NOT NULL,
  "response" VARCHAR(16) NOT NULL DEFAULT 'PENDING', "responded_at" TIMESTAMPTZ(6), CONSTRAINT "appointment_participants_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "appointment_events" (
  "id" UUID NOT NULL, "appointment_id" UUID NOT NULL, "idempotency_key" VARCHAR(128) NOT NULL, "event_type" VARCHAR(48) NOT NULL,
  "from_state" VARCHAR(24), "to_state" VARCHAR(24), "actor_id" VARCHAR(64) NOT NULL, "reason_code" VARCHAR(120),
  "compensates_event_id" UUID, "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "appointment_events_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "interview_reports" (
  "id" UUID NOT NULL, "appointment_id" UUID NOT NULL, "result" VARCHAR(32) NOT NULL, "redacted_comment" VARCHAR(32) NOT NULL,
  "redacted_missing_points" VARCHAR(32), "next_action" VARCHAR(120), "follow_up_at" TIMESTAMPTZ(6), "redacted_recommendation" VARCHAR(32) NOT NULL,
  "validated_by" VARCHAR(64) NOT NULL, "validated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "compensates_report_id" UUID,
  CONSTRAINT "interview_reports_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "appointments_lead_id_starts_at_idx" ON "appointments"("lead_id", "starts_at" DESC);
CREATE INDEX "appointments_adviser_id_starts_at_idx" ON "appointments"("adviser_id", "starts_at");
CREATE INDEX "appointments_campus_state_starts_at_idx" ON "appointments"("campus", "state", "starts_at");
CREATE UNIQUE INDEX "appointment_participants_appointment_id_user_id_role_key" ON "appointment_participants"("appointment_id", "user_id", "role");
CREATE INDEX "appointment_participants_user_id_response_idx" ON "appointment_participants"("user_id", "response");
CREATE UNIQUE INDEX "appointment_events_idempotency_key_key" ON "appointment_events"("idempotency_key");
CREATE INDEX "appointment_events_appointment_id_occurred_at_id_idx" ON "appointment_events"("appointment_id", "occurred_at", "id");
CREATE INDEX "interview_reports_appointment_id_validated_at_idx" ON "interview_reports"("appointment_id", "validated_at");
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id");
ALTER TABLE "appointment_participants" ADD CONSTRAINT "appointment_participants_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id");
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id");
ALTER TABLE "interview_reports" ADD CONSTRAINT "interview_reports_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id");
