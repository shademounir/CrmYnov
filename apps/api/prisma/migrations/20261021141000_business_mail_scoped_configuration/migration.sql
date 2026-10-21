-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated
-- Empty, OFF configuration storage only; no business/history/permission backfill.
CREATE TABLE "business_mail_configurations" (
  "id" VARCHAR(40) NOT NULL,
  "settings" JSONB NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "activated_at" TIMESTAMPTZ(6),
  "qualification_key" VARCHAR(64),
  "preflight" JSONB,
  "preflight_at" TIMESTAMPTZ(6),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "business_mail_configurations_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "business_mail_memberships" (
  "id" UUID NOT NULL,
  "campus_id" UUID NOT NULL,
  "campaign_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "business_mail_memberships_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "business_mail_memberships_campus_id_campaign_id_user_id_key" ON "business_mail_memberships"("campus_id", "campaign_id", "user_id");
CREATE INDEX "business_mail_memberships_campus_id_campaign_id_active_idx" ON "business_mail_memberships"("campus_id", "campaign_id", "active");
