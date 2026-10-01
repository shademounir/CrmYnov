-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated

CREATE TABLE "collaborators" (
  "id" UUID NOT NULL,
  "professional_email" VARCHAR(254) NOT NULL,
  "secondary_email" VARCHAR(254),
  "roles" TEXT[] NOT NULL,
  "campus_id" VARCHAR(64),
  "team_id" VARCHAR(64),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "collaborators_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "collaborators_professional_email_key" ON "collaborators"("professional_email");
CREATE INDEX "collaborators_active_campus_id_team_id_idx" ON "collaborators"("active", "campus_id", "team_id");
