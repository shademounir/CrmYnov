-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated

CREATE TABLE "local_password_hashes" (
  "id" UUID NOT NULL,
  "collaborator_id" UUID NOT NULL,
  "identity_digest" VARCHAR(64) NOT NULL,
  "password_salt" VARCHAR(64) NOT NULL,
  "password_digest" VARCHAR(128) NOT NULL,
  "must_change" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "local_password_hashes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "local_sessions" (
  "id" UUID NOT NULL,
  "collaborator_id" UUID NOT NULL,
  "token_digest" VARCHAR(64) NOT NULL,
  "roles" TEXT[],
  "scopes" JSONB NOT NULL,
  "authentication_version" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "local_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "local_recovery_challenges" (
  "id" UUID NOT NULL,
  "collaborator_id" UUID NOT NULL,
  "token_digest" VARCHAR(64) NOT NULL,
  "return_path" VARCHAR(160) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "used_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "local_recovery_challenges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "local_password_hashes_collaborator_id_key" ON "local_password_hashes"("collaborator_id");
CREATE UNIQUE INDEX "local_password_hashes_identity_digest_key" ON "local_password_hashes"("identity_digest");
CREATE UNIQUE INDEX "local_sessions_token_digest_key" ON "local_sessions"("token_digest");
CREATE INDEX "local_sessions_collaborator_id_active_expires_at_idx" ON "local_sessions"("collaborator_id", "active", "expires_at");
CREATE UNIQUE INDEX "local_recovery_challenges_token_digest_key" ON "local_recovery_challenges"("token_digest");
CREATE INDEX "local_recovery_challenges_collaborator_id_expires_at_idx" ON "local_recovery_challenges"("collaborator_id", "expires_at");

ALTER TABLE "local_password_hashes" ADD CONSTRAINT "local_password_hashes_collaborator_id_fkey" FOREIGN KEY ("collaborator_id") REFERENCES "collaborators"("id");
ALTER TABLE "local_sessions" ADD CONSTRAINT "local_sessions_collaborator_id_fkey" FOREIGN KEY ("collaborator_id") REFERENCES "collaborators"("id");
ALTER TABLE "local_recovery_challenges" ADD CONSTRAINT "local_recovery_challenges_collaborator_id_fkey" FOREIGN KEY ("collaborator_id") REFERENCES "collaborators"("id");
