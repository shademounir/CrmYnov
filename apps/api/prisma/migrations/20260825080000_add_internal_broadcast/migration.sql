-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated

CREATE TABLE "broadcasts" (
  "id" UUID NOT NULL,
  "title" CHARACTER VARYING(120) NOT NULL,
  "content" CHARACTER VARYING(4000) NOT NULL,
  "internal_link" CHARACTER VARYING(500),
  "author_id" CHARACTER VARYING(64) NOT NULL,
  "state" CHARACTER VARYING(24) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "audience" JSONB NOT NULL,
  "recipient_count" INTEGER NOT NULL DEFAULT 0,
  "correction_of" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmed_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "broadcasts_created_at_id_idx" ON "broadcasts"("created_at" DESC, "id");
CREATE INDEX "broadcasts_author_id_created_at_idx" ON "broadcasts"("author_id", "created_at" DESC);
CREATE INDEX "broadcasts_correction_of_idx" ON "broadcasts"("correction_of");

CREATE TABLE "broadcast_recipients" (
  "broadcast_id" UUID NOT NULL,
  "user_id" CHARACTER VARYING(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "broadcast_recipients_pkey" PRIMARY KEY ("broadcast_id", "user_id"),
  CONSTRAINT "broadcast_recipients_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "broadcasts"("id")
);

CREATE INDEX "broadcast_recipients_user_id_created_at_idx" ON "broadcast_recipients"("user_id", "created_at" DESC);
