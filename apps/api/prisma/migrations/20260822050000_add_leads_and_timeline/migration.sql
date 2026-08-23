-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated

CREATE TABLE "leads" (
  "id" UUID NOT NULL,
  "lead_code" VARCHAR(32) NOT NULL,
  "first_name" VARCHAR(100) NOT NULL,
  "last_name" VARCHAR(100) NOT NULL,
  "email" VARCHAR(254),
  "phone" VARCHAR(32),
  "campus" VARCHAR(80) NOT NULL,
  "campaign" VARCHAR(120) NOT NULL,
  "education_level" VARCHAR(80) NOT NULL,
  "program" VARCHAR(120) NOT NULL,
  "source" VARCHAR(80) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'PROSPECT',
  "assigned_to_id" UUID,
  "next_action_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lead_activities" (
  "id" UUID NOT NULL,
  "lead_id" UUID NOT NULL,
  "type" VARCHAR(32) NOT NULL,
  "result" VARCHAR(120) NOT NULL,
  "note" VARCHAR(2000),
  "author_id" VARCHAR(64) NOT NULL,
  "next_action_at" TIMESTAMPTZ(6),
  "correlation_id" VARCHAR(64) NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lead_activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id")
);

CREATE UNIQUE INDEX "leads_lead_code_key" ON "leads"("lead_code");
CREATE INDEX "leads_assigned_to_id_status_idx" ON "leads"("assigned_to_id", "status");
CREATE INDEX "leads_status_next_action_at_idx" ON "leads"("status", "next_action_at");
CREATE INDEX "leads_last_name_first_name_lead_code_idx" ON "leads"("last_name", "first_name", "lead_code");
CREATE INDEX "leads_source_program_created_at_idx" ON "leads"("source", "program", "created_at");
CREATE INDEX "lead_activities_lead_id_occurred_at_id_idx" ON "lead_activities"("lead_id", "occurred_at" DESC, "id");
