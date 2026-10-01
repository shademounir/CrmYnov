-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated

CREATE TABLE "assignment_rules" (
  "id" UUID NOT NULL,
  "scope" VARCHAR(16) NOT NULL,
  "match_value" VARCHAR(120),
  "strategy" VARCHAR(32) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "cursor" INTEGER NOT NULL DEFAULT 0,
  "updated_by" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "assignment_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "assignment_rule_candidates" (
  "id" UUID NOT NULL,
  "rule_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "suspended" BOOLEAN NOT NULL DEFAULT false,
  "excluded" BOOLEAN NOT NULL DEFAULT false,
  "capacity" INTEGER NOT NULL,
  "active_lead_count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "assignment_rule_candidates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assignment_rule_candidates_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "assignment_rules"("id")
);

CREATE TABLE "assignment_decisions" (
  "id" UUID NOT NULL,
  "event_key" VARCHAR(128) NOT NULL,
  "lead_id" UUID NOT NULL,
  "rule_id" UUID NOT NULL,
  "strategy" VARCHAR(32) NOT NULL,
  "selected_user_id" UUID NOT NULL,
  "candidate_fingerprint" VARCHAR(64) NOT NULL,
  "algorithm_version" VARCHAR(32) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assignment_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assignment_decisions_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "assignment_rules"("id")
);

CREATE UNIQUE INDEX "assignment_rules_scope_match_value_key" ON "assignment_rules"("scope", "match_value");
CREATE INDEX "assignment_rules_enabled_scope_idx" ON "assignment_rules"("enabled", "scope");
CREATE UNIQUE INDEX "assignment_rule_candidates_rule_id_user_id_key" ON "assignment_rule_candidates"("rule_id", "user_id");
CREATE INDEX "assignment_rule_candidates_rule_id_active_suspended_excluded_idx" ON "assignment_rule_candidates"("rule_id", "active", "suspended", "excluded");
CREATE UNIQUE INDEX "assignment_decisions_event_key_key" ON "assignment_decisions"("event_key");
CREATE INDEX "assignment_decisions_lead_id_created_at_idx" ON "assignment_decisions"("lead_id", "created_at" DESC);
CREATE INDEX "assignment_decisions_selected_user_id_created_at_idx" ON "assignment_decisions"("selected_user_id", "created_at" DESC);
