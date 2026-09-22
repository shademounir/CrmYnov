-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated
-- Rollback after exporting required evidence: DROP TABLE "internal_notifications";
CREATE TABLE "internal_notifications" (
  "id" UUID NOT NULL,
  "recipient_id" CHARACTER VARYING(64) NOT NULL,
  "type" CHARACTER VARYING(40) NOT NULL,
  "priority" CHARACTER VARYING(16) NOT NULL,
  "resource_type" CHARACTER VARYING(40) NOT NULL,
  "resource_id" CHARACTER VARYING(64) NOT NULL,
  "href" CHARACTER VARYING(320) NOT NULL,
  "deduplication_key" CHARACTER VARYING(160) NOT NULL,
  "fingerprint" CHARACTER VARYING(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "read_at" TIMESTAMPTZ(6),
  CONSTRAINT "internal_notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "internal_notifications_priority_check" CHECK ("priority" IN ('LOW', 'NORMAL', 'HIGH')),
  CONSTRAINT "internal_notifications_type_check" CHECK ("type" IN ('ASSIGNMENT', 'REASSIGNMENT_DECISION', 'CLOSURE_REQUEST', 'COLLABORATOR_REQUEST', 'FOLLOW_UP_DUE', 'IMPORT_REVIEW', 'CHAT_MENTION', 'BROADCAST', 'BROADCAST_CORRECTION', 'DOCUMENT_RECEIVED', 'DOCUMENT_VALIDATED', 'DOCUMENT_REFUSED', 'APPOINTMENT')),
  CONSTRAINT "internal_notifications_resource_type_check" CHECK ("resource_type" IN ('LEAD', 'IMPORT', 'CHAT', 'BROADCAST', 'DOCUMENT', 'APPOINTMENT')),
  CONSTRAINT "internal_notifications_href_check" CHECK (
    ("href" LIKE '/leads/%' OR "href" LIKE '/imports/%' OR "href" LIKE '/chat/%' OR "href" LIKE '/broadcasts/%' OR "href" LIKE '/appointments/%')
    AND "href" NOT LIKE '%?%' AND "href" NOT LIKE '%#%' AND "href" NOT LIKE '% %'
  )
);

CREATE UNIQUE INDEX "internal_notifications_deduplication_key_key" ON "internal_notifications"("deduplication_key");
CREATE INDEX "internal_notifications_recipient_id_created_at_id_idx" ON "internal_notifications"("recipient_id", "created_at" DESC, "id" DESC);
CREATE INDEX "internal_notifications_recipient_id_read_at_created_at_idx" ON "internal_notifications"("recipient_id", "read_at", "created_at" DESC);
CREATE INDEX "internal_notifications_resource_type_resource_id_idx" ON "internal_notifications"("resource_type", "resource_id");
