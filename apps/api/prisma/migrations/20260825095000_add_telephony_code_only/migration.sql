-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated

CREATE TABLE "telephony_configurations" (
  "id" UUID NOT NULL,
  "mode" VARCHAR(24) NOT NULL DEFAULT 'DISABLED',
  "click_to_call_enabled" BOOLEAN NOT NULL DEFAULT false,
  "inbound_enabled" BOOLEAN NOT NULL DEFAULT false,
  "outbound_enabled" BOOLEAN NOT NULL DEFAULT false,
  "recording_policy" VARCHAR(24) NOT NULL DEFAULT 'DISABLED',
  "max_call_duration_seconds" INTEGER NOT NULL DEFAULT 7200,
  "provider_configuration_ref" VARCHAR(160),
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_by" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "telephony_configurations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telephony_recording_metadata" (
  "id" UUID NOT NULL,
  "provider" VARCHAR(24) NOT NULL,
  "state" VARCHAR(16) NOT NULL DEFAULT 'UNAVAILABLE',
  "durationSeconds" INTEGER,
  "storage_reference" VARCHAR(160),
  "authorized_roles" TEXT[],
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telephony_recording_metadata_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telephony_calls" (
  "id" UUID NOT NULL,
  "provider" VARCHAR(24) NOT NULL,
  "external_id" VARCHAR(128) NOT NULL,
  "direction" VARCHAR(16) NOT NULL,
  "state" VARCHAR(16) NOT NULL,
  "lead_id" UUID,
  "phone_fingerprint" VARCHAR(64) NOT NULL,
  "match_state" VARCHAR(24) NOT NULL DEFAULT 'UNMATCHED',
  "requested_at" TIMESTAMPTZ(6) NOT NULL,
  "answered_at" TIMESTAMPTZ(6),
  "ended_at" TIMESTAMPTZ(6),
  "duration_seconds" INTEGER,
  "created_by" VARCHAR(64) NOT NULL,
  "recording_id" UUID,
  CONSTRAINT "telephony_calls_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telephony_call_events" (
  "id" UUID NOT NULL,
  "call_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "event_type" VARCHAR(32) NOT NULL,
  "state" VARCHAR(16) NOT NULL,
  "reason_code" VARCHAR(64),
  "actor_id" VARCHAR(64),
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telephony_call_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telephony_recording_access_events" (
  "id" UUID NOT NULL,
  "recording_id" UUID NOT NULL,
  "actor_id" VARCHAR(64) NOT NULL,
  "outcome" VARCHAR(24) NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telephony_recording_access_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telephony_calls_provider_external_id_key" ON "telephony_calls"("provider", "external_id");
CREATE INDEX "telephony_calls_lead_id_requested_at_idx" ON "telephony_calls"("lead_id", "requested_at" DESC);
CREATE INDEX "telephony_calls_match_state_requested_at_idx" ON "telephony_calls"("match_state", "requested_at" DESC);
CREATE UNIQUE INDEX "telephony_call_events_idempotency_key_key" ON "telephony_call_events"("idempotency_key");
CREATE INDEX "telephony_call_events_call_id_occurred_at_id_idx" ON "telephony_call_events"("call_id", "occurred_at", "id");
CREATE INDEX "telephony_recording_access_events_recording_id_occurred_at_idx" ON "telephony_recording_access_events"("recording_id", "occurred_at" DESC);

ALTER TABLE "telephony_calls" ADD CONSTRAINT "telephony_calls_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id");
ALTER TABLE "telephony_calls" ADD CONSTRAINT "telephony_calls_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "telephony_recording_metadata"("id");
ALTER TABLE "telephony_call_events" ADD CONSTRAINT "telephony_call_events_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "telephony_calls"("id");
ALTER TABLE "telephony_recording_access_events" ADD CONSTRAINT "telephony_recording_access_events_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "telephony_recording_metadata"("id");
