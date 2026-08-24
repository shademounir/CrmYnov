-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated

ALTER TABLE "chat_conversations" ADD COLUMN "lead_id" UUID, ADD COLUMN "lead_code" VARCHAR(32);
CREATE INDEX "chat_conversations_lead_id_updated_at_idx" ON "chat_conversations"("lead_id", "updated_at" DESC);

CREATE TABLE "chat_mentions" (
  "message_id" UUID NOT NULL,
  "user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_mentions_pkey" PRIMARY KEY ("message_id", "user_id"),
  CONSTRAINT "chat_mentions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id")
);

CREATE INDEX "chat_mentions_user_id_created_at_idx" ON "chat_mentions"("user_id", "created_at" DESC);

CREATE TABLE "chat_activity_conversions" (
  "id" UUID NOT NULL,
  "message_id" UUID NOT NULL,
  "lead_id" UUID NOT NULL,
  "activity_id" UUID NOT NULL,
  "converted_by" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_activity_conversions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chat_activity_conversions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id")
);

CREATE UNIQUE INDEX "chat_activity_conversions_message_id_key" ON "chat_activity_conversions"("message_id");
CREATE UNIQUE INDEX "chat_activity_conversions_activity_id_key" ON "chat_activity_conversions"("activity_id");
CREATE INDEX "chat_activity_conversions_lead_id_created_at_idx" ON "chat_activity_conversions"("lead_id", "created_at" DESC);
