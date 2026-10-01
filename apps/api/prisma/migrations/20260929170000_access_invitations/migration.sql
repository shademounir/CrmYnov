-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated
CREATE TABLE "local_access_invitations" (
  "id" UUID NOT NULL,
  "collaborator_id" UUID NOT NULL,
  "link_digest" VARCHAR(64) NOT NULL,
  "state" VARCHAR(24) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "sent_at" TIMESTAMPTZ(6),
  "used_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "local_access_invitations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "local_access_invitations_link_digest_key" ON "local_access_invitations"("link_digest");
CREATE INDEX "local_access_invitations_collaborator_id_state_expires_at_idx" ON "local_access_invitations"("collaborator_id", "state", "expires_at");
ALTER TABLE "local_access_invitations" ADD CONSTRAINT "local_access_invitations_collaborator_id_fkey" FOREIGN KEY ("collaborator_id") REFERENCES "collaborators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
