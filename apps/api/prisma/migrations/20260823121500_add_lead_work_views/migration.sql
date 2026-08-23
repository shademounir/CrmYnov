-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated

ALTER TABLE "leads" ADD COLUMN "assignment_mode" VARCHAR(32);
ALTER TABLE "leads" ADD COLUMN "import_batch_id" VARCHAR(64);
ALTER TABLE "leads" ADD COLUMN "last_activity_at" TIMESTAMPTZ(6);

CREATE TABLE "lead_collaborators" (
  "id" UUID NOT NULL,
  "lead_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_collaborators_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lead_collaborators_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id")
);

CREATE INDEX "leads_assignment_mode_import_batch_id_idx"
  ON "leads"("assignment_mode", "import_batch_id");
CREATE UNIQUE INDEX "lead_collaborators_lead_id_user_id_key" ON "lead_collaborators"("lead_id", "user_id");
CREATE INDEX "lead_collaborators_user_id_active_idx" ON "lead_collaborators"("user_id", "active");
