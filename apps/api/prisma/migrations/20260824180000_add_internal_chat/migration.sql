-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated

CREATE TABLE "chat_conversations" (
  "id" UUID NOT NULL,
  "type" VARCHAR(24) NOT NULL,
  "title" VARCHAR(120),
  "created_by_id" VARCHAR(64) NOT NULL,
  "retention_until" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "chat_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chat_participants" (
  "conversation_id" UUID NOT NULL,
  "user_id" VARCHAR(64) NOT NULL,
  "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "left_at" TIMESTAMPTZ(6),
  CONSTRAINT "chat_participants_pkey" PRIMARY KEY ("conversation_id", "user_id")
);

CREATE TABLE "chat_messages" (
  "id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "author_id" VARCHAR(64) NOT NULL,
  "content" VARCHAR(2000),
  "version" INTEGER NOT NULL DEFAULT 1,
  "edited_at" TIMESTAMPTZ(6),
  "deleted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chat_message_versions" (
  "id" UUID NOT NULL,
  "message_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "content" VARCHAR(2000),
  "changed_by" VARCHAR(64) NOT NULL,
  "change" VARCHAR(16) NOT NULL,
  "reason" VARCHAR(240),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_message_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chat_read_receipts" (
  "conversation_id" UUID NOT NULL,
  "user_id" VARCHAR(64) NOT NULL,
  "last_read_message_id" UUID,
  "read_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "chat_read_receipts_pkey" PRIMARY KEY ("conversation_id", "user_id")
);

CREATE INDEX "chat_conversations_updated_at_id_idx" ON "chat_conversations"("updated_at" DESC, "id");
CREATE INDEX "chat_participants_user_id_left_at_idx" ON "chat_participants"("user_id", "left_at");
CREATE INDEX "chat_messages_conversation_id_created_at_id_idx" ON "chat_messages"("conversation_id", "created_at", "id");
CREATE UNIQUE INDEX "chat_message_versions_message_id_version_key" ON "chat_message_versions"("message_id", "version");
CREATE INDEX "chat_read_receipts_user_id_read_at_idx" ON "chat_read_receipts"("user_id", "read_at" DESC);

ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id");
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id");
ALTER TABLE "chat_message_versions" ADD CONSTRAINT "chat_message_versions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id");
ALTER TABLE "chat_read_receipts" ADD CONSTRAINT "chat_read_receipts_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id");
