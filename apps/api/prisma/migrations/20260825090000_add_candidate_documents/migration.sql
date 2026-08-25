-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated

CREATE TABLE "candidate_document_checklist_items" (
  "id" UUID NOT NULL,
  "lead_id" UUID NOT NULL,
  "document_type" CHARACTER VARYING(48) NOT NULL,
  "state" CHARACTER VARYING(24) NOT NULL DEFAULT 'MANQUANT',
  "requirement_code" CHARACTER VARYING(80) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "candidate_document_checklist_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "candidate_document_checklist_items_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id")
);
CREATE UNIQUE INDEX "candidate_document_checklist_items_lead_id_document_type_requirement_code_key" ON "candidate_document_checklist_items"("lead_id", "document_type", "requirement_code");
CREATE INDEX "candidate_document_checklist_items_state_document_type_idx" ON "candidate_document_checklist_items"("state", "document_type");

CREATE TABLE "candidate_documents" (
  "id" UUID NOT NULL,
  "lead_id" UUID NOT NULL,
  "checklist_item_id" UUID,
  "document_type" CHARACTER VARYING(48) NOT NULL,
  "sanitized_file_name" CHARACTER VARYING(160) NOT NULL,
  "extension" CHARACTER VARYING(12) NOT NULL,
  "declared_mime" CHARACTER VARYING(100) NOT NULL,
  "detected_mime" CHARACTER VARYING(100) NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "storage_reference" CHARACTER VARYING(180) NOT NULL,
  "uploaded_by" CHARACTER VARYING(64) NOT NULL,
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verification_status" CHARACTER VARYING(24) NOT NULL DEFAULT 'A_VERIFIER',
  "verified_by" CHARACTER VARYING(64),
  "verified_at" TIMESTAMPTZ(6),
  "refusal_reason_code" CHARACTER VARYING(64),
  "version" INTEGER NOT NULL DEFAULT 1,
  "replaced_document_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "candidate_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "candidate_documents_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id")
);
CREATE UNIQUE INDEX "candidate_documents_lead_id_document_type_version_key" ON "candidate_documents"("lead_id", "document_type", "version");
CREATE INDEX "candidate_documents_lead_id_verification_status_received_at_idx" ON "candidate_documents"("lead_id", "verification_status", "received_at" DESC);
CREATE INDEX "candidate_documents_storage_reference_idx" ON "candidate_documents"("storage_reference");

CREATE TABLE "candidate_document_events" (
  "id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "event_type" CHARACTER VARYING(48) NOT NULL,
  "actor_id" CHARACTER VARYING(64) NOT NULL,
  "reason_code" CHARACTER VARYING(64),
  "correlation_id" CHARACTER VARYING(64) NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "candidate_document_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "candidate_document_events_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "candidate_documents"("id")
);
CREATE INDEX "candidate_document_events_document_id_occurred_at_id_idx" ON "candidate_document_events"("document_id", "occurred_at", "id");
