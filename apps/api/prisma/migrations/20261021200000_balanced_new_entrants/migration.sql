-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- Additive prospective ledger. No historical lead, owner, cursor or rule is rewritten.
CREATE TABLE "campus_new_assignment_counters" (
  "campus_id" UUID NOT NULL,
  "version" INTEGER NOT NULL CHECK ("version" > 0),
  "rule_id" VARCHAR(64) NOT NULL,
  "user_id" UUID NOT NULL,
  "assigned_count" INTEGER NOT NULL DEFAULT 0 CHECK ("assigned_count" >= 0),
  CONSTRAINT "campus_new_assignment_counters_pkey" PRIMARY KEY ("campus_id", "version", "rule_id", "user_id"),
  FOREIGN KEY ("campus_id", "version") REFERENCES "campus_assignment_versions" ("campus_id", "version"),
  FOREIGN KEY ("user_id") REFERENCES "collaborators" ("id")
);
CREATE TABLE "campus_new_assignment_receipts" (
  "event_hash" VARCHAR(64) PRIMARY KEY CHECK ("event_hash" ~ '^[0-9a-f]{64}$'),
  "lead_id" UUID NOT NULL,
  "campus_id" UUID NOT NULL,
  "version" INTEGER NOT NULL CHECK ("version" > 0),
  "rule_id" VARCHAR(64) NOT NULL,
  "user_id" UUID NOT NULL,
  "count_after" INTEGER NOT NULL CHECK ("count_after" > 0),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "campus_new_assignment_receipts_lead_id_key" UNIQUE ("lead_id"),
  FOREIGN KEY ("campus_id", "version", "rule_id", "user_id") REFERENCES "campus_new_assignment_counters" ("campus_id", "version", "rule_id", "user_id"),
  FOREIGN KEY ("lead_id") REFERENCES "leads" ("id")
);
CREATE INDEX "campus_new_assignment_receipts_campus_id_version_rule_id_idx"
  ON "campus_new_assignment_receipts" ("campus_id", "version", "rule_id");
