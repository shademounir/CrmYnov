-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated
-- Explicit responsibility only: no inference or backfill from existing memberships.
CREATE TABLE "team_responsibilities" (
  "id" UUID NOT NULL,
  "team_id" VARCHAR(64) NOT NULL,
  "campus_id" UUID NOT NULL,
  "manager_id" UUID NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "team_responsibilities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "team_responsibilities_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "collaborators"("id"),
  CONSTRAINT "team_responsibilities_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "crm_references"("id")
);
CREATE UNIQUE INDEX "team_responsibilities_team_id_campus_id_manager_id_key" ON "team_responsibilities"("team_id", "campus_id", "manager_id");
