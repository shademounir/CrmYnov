-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated
-- All unique indexes concern newly created empty tables. No historical lead is rewritten.
CREATE TABLE "crm_references" (
  "id" UUID NOT NULL, "kind" VARCHAR(24) NOT NULL, "code" VARCHAR(120) NOT NULL,
  "label" VARCHAR(120) NOT NULL, "scope" VARCHAR(12) NOT NULL, "campus_id" UUID,
  "scope_key" VARCHAR(40) NOT NULL, "state" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "crm_references_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crm_references_kind" CHECK ("kind" IN ('CAMPUS','PROGRAM','SCHOLARSHIP','CAMPAIGN','TAG')),
  CONSTRAINT "crm_references_state" CHECK ("state" IN ('ACTIVE','ARCHIVED','LEGACY')),
  CONSTRAINT "crm_references_scope" CHECK (("scope" = 'GLOBAL' AND "campus_id" IS NULL AND "scope_key" = 'GLOBAL') OR ("scope" = 'CAMPUS' AND "campus_id" IS NOT NULL AND "scope_key" = CAST("campus_id" AS TEXT))),
  CONSTRAINT "crm_references_global" CHECK ("kind" IN ('CAMPAIGN','TAG') OR "scope" = 'GLOBAL'),
  CONSTRAINT "crm_references_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "crm_references"("id")
);
CREATE UNIQUE INDEX "crm_references_kind_scope_key_code_key" ON "crm_references"("kind","scope_key","code");
CREATE INDEX "crm_references_kind_state_campus_id_idx" ON "crm_references"("kind","state","campus_id");
CREATE TABLE "crm_reference_keys" (
  "id" UUID NOT NULL, "reference_id" UUID NOT NULL, "kind" VARCHAR(24) NOT NULL,
  "scope_key" VARCHAR(40) NOT NULL, "key" VARCHAR(120) NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "crm_reference_keys_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crm_reference_keys_reference_id_fkey" FOREIGN KEY ("reference_id") REFERENCES "crm_references"("id")
);
CREATE UNIQUE INDEX "crm_reference_keys_kind_scope_key_key_key" ON "crm_reference_keys"("kind","scope_key","key");
CREATE TABLE "crm_program_availability" (
  "program_id" UUID NOT NULL, "campus_id" UUID NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true, "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "crm_program_availability_pkey" PRIMARY KEY ("program_id","campus_id"),
  CONSTRAINT "crm_program_availability_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "crm_references"("id"),
  CONSTRAINT "crm_program_availability_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "crm_references"("id")
);
CREATE TABLE "crm_lead_tags" (
  "lead_id" UUID NOT NULL, "tag_id" UUID NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "crm_lead_tags_pkey" PRIMARY KEY ("lead_id","tag_id"),
  CONSTRAINT "crm_lead_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "crm_references"("id"),
  CONSTRAINT "crm_lead_tags_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id")
);
