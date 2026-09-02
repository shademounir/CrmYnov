-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated
CREATE TABLE "role_permission_configurations" (
  "id" VARCHAR(200) PRIMARY KEY,
  "kind" VARCHAR(16) NOT NULL CHECK ("kind" IN ('CEILING', 'ROLE')),
  "role" VARCHAR(20) NOT NULL,
  "campus" VARCHAR(80) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0 CHECK ("version" >= 0)
);
CREATE TABLE "role_permission_versions" (
  "id" UUID PRIMARY KEY,
  "configuration_id" VARCHAR(200) NOT NULL REFERENCES "role_permission_configurations"("id"),
  "number" INTEGER NOT NULL CHECK ("number" > 0),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("configuration_id", "number")
);
CREATE TABLE "role_permission_grants" (
  "id" UUID PRIMARY KEY,
  "version_id" UUID NOT NULL REFERENCES "role_permission_versions"("id"),
  "permission" VARCHAR(80) NOT NULL,
  "scope" VARCHAR(10) NOT NULL CHECK ("scope" IN ('NONE', 'OWN', 'TEAM', 'CAMPUS', 'GLOBAL')),
  UNIQUE ("version_id", "permission")
);
CREATE TABLE "role_permission_audit_events" (
  "id" UUID PRIMARY KEY,
  "version_id" UUID NOT NULL REFERENCES "role_permission_versions"("id"),
  "actor_id" UUID NOT NULL,
  "actor_roles" JSONB NOT NULL,
  "reason" VARCHAR(40) NOT NULL,
  "previous" JSONB NOT NULL,
  "next" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "role_permission_audit_events_version_id_created_at_idx" ON "role_permission_audit_events"("version_id", "created_at");
