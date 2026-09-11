-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- Additive, no migration of volatile or historical rules.
CREATE TABLE campus_assignment_configurations (
  campus_id UUID PRIMARY KEY REFERENCES crm_references(id),
  version INTEGER NOT NULL CHECK (version > 0)
);
CREATE TABLE campus_assignment_versions (
  campus_id UUID NOT NULL REFERENCES campus_assignment_configurations(campus_id),
  version INTEGER NOT NULL CHECK (version > 0),
  rules JSONB NOT NULL,
  actor_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (campus_id, version)
);
CREATE TABLE campus_assignment_cursors (
  campus_id UUID NOT NULL,
  version INTEGER NOT NULL,
  rule_id VARCHAR(64) NOT NULL,
  cursor INTEGER NOT NULL DEFAULT 0 CHECK (cursor >= 0),
  PRIMARY KEY (campus_id, version, rule_id),
  FOREIGN KEY (campus_id, version) REFERENCES campus_assignment_versions(campus_id, version)
);
