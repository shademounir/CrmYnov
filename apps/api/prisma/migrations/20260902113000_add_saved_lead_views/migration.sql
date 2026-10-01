-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated

CREATE TABLE "saved_lead_views" (
  "id" UUID NOT NULL,
  "owner_id" VARCHAR(64) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "filters" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "saved_lead_views_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "saved_lead_views_owner_id_name_key" ON "saved_lead_views"("owner_id", "name");
CREATE INDEX "saved_lead_views_owner_id_updated_at_idx" ON "saved_lead_views"("owner_id", "updated_at" DESC);
