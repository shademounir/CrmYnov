-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated
ALTER TABLE "saved_lead_views" ADD COLUMN "archived_at" TIMESTAMPTZ(6);
CREATE TABLE "saved_lead_view_shares" (
  "id" UUID NOT NULL,
  "view_id" UUID NOT NULL REFERENCES "saved_lead_views"("id"),
  "audience_key" VARCHAR(80) NOT NULL,
  "kind" VARCHAR(10) NOT NULL CHECK ("kind" IN ('TEAM', 'CAMPUS')),
  "campus_id" UUID NOT NULL,
  "responsibility_id" UUID,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "saved_lead_view_shares_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "saved_view_audience_shape" CHECK (("kind" = 'TEAM' AND "responsibility_id" IS NOT NULL) OR ("kind" = 'CAMPUS' AND "responsibility_id" IS NULL))
);
CREATE UNIQUE INDEX "saved_lead_view_shares_view_id_audience_key_key" ON "saved_lead_view_shares"("view_id", "audience_key");
CREATE INDEX "saved_lead_view_shares_campus_id_active_idx" ON "saved_lead_view_shares"("campus_id", "active");
CREATE TABLE "saved_view_mutations" (
  "id" UUID NOT NULL,
  "actor_id" VARCHAR(64) NOT NULL,
  "key" VARCHAR(64) NOT NULL,
  "fingerprint" VARCHAR(64) NOT NULL,
  "response" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "saved_view_mutations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "saved_view_mutations_actor_id_key_key" ON "saved_view_mutations"("actor_id", "key");
