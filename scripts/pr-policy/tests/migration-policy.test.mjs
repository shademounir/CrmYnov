import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  analyzeMigrationSql,
  assessChangedPrismaMigrations,
  validateMigrationWorkflow,
} from "../migration-policy.mjs";
import { runMigrationCi } from "../migration-ci.mjs";

const markers = `-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
`;
const ephemeralWorkflow = `
jobs:
  migration:
    services:
      postgres:
        image: postgres:17.6-bookworm
    steps:
      - uses: actions/checkout@${"a".repeat(40)}
        with:
          persist-credentials: false
      - run: node scripts/pr-policy/migration-ci.mjs
        env:
          DATABASE_URL: postgresql://crm_policy:synthetic-only@127.0.0.1:5432/crm_policy
`;

test("accepts a marked additive migration", () => {
  const sql = `${markers}
CREATE TABLE "teams" ("id" UUID NOT NULL, CONSTRAINT "teams_pkey" PRIMARY KEY ("id"));
CREATE INDEX "teams_id_idx" ON "teams"("id");
ALTER TABLE "teams" ADD COLUMN "label" TEXT;
ALTER TABLE "teams" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "teams" ADD CONSTRAINT "teams_parent_fkey" FOREIGN KEY ("id") REFERENCES "teams"("id");`;
  assert.deepEqual(analyzeMigrationSql(sql).reasons, []);
});

for (const [name, sql, reason] of [
  ["DROP", "DROP TABLE users", "migration_destructive_or_data_statement"],
  ["TRUNCATE", "TRUNCATE TABLE users", "migration_destructive_or_data_statement"],
  ["data UPDATE", "UPDATE users SET active = true", "migration_destructive_or_data_statement"],
  ["data INSERT", "INSERT INTO users VALUES (1)", "migration_destructive_or_data_statement"],
  ["rename", "ALTER TABLE users RENAME COLUMN name TO label", "migration_destructive_alteration"],
  ["type change", "ALTER TABLE users ALTER COLUMN id TYPE TEXT", "migration_destructive_alteration"],
  ["unsafe not null", "ALTER TABLE users ALTER COLUMN email SET NOT NULL", "migration_destructive_alteration"],
  ["ambiguous SQL", "DO $$ BEGIN RAISE NOTICE 'x'; END $$", "migration_sql_ambiguous"],
  ["persistent URL", "SELECT 'postgresql://user:pass@database.example/app'", "migration_persistent_or_secret_reference"],
]) {
  test(`refuses ${name} with a stable reason`, () => {
    const assessment = analyzeMigrationSql(`${markers}${sql};`);
    assert.equal(assessment.approved, false);
    assert.ok(assessment.reasons.includes(reason));
  });
}

test("requires explicit uniqueness proof", () => {
  assert.ok(analyzeMigrationSql(`${markers}CREATE UNIQUE INDEX users_email_key ON users(email);`).reasons.includes("migration_unique_index_proof_missing"));
  assert.equal(analyzeMigrationSql(`${markers}-- prisma-policy: uniqueness-validated\nCREATE UNIQUE INDEX users_email_key ON users(email);`).approved, true);
});

test("refuses persistent or secret-backed migration workflows", () => {
  assert.equal(validateMigrationWorkflow(ephemeralWorkflow).approved, true);
  const persistent = ephemeralWorkflow.replace("127.0.0.1", "cloudsql.example").replace("steps:", "steps:\n      # \${{ secrets.DATABASE_URL }}");
  const assessment = validateMigrationWorkflow(persistent);
  assert.equal(assessment.approved, false);
  assert.ok(assessment.reasons.includes("migration_workflow_persistent_or_secret_reference"));
});

test("assesses versioned SQL, rollback and workflow together", async () => {
  const root = await mkdtemp(join(tmpdir(), "crmynov-migration-policy-"));
  const directory = join(root, "apps", "api", "prisma", "migrations", "20260817_add_teams");
  const workflowDirectory = join(root, ".github", "workflows");
  await mkdir(directory, { recursive: true });
  await mkdir(workflowDirectory, { recursive: true });
  await writeFile(join(directory, "migration.sql"), `${markers}CREATE TABLE teams (id UUID NOT NULL);`);
  await writeFile(join(directory, "rollback.md"), "Rollback applicatif: revenir au code précédent; la table additive reste inutilisée.");
  await writeFile(join(workflowDirectory, "prisma-migration-policy.yml"), ephemeralWorkflow);
  const changedFiles = [
    "apps/api/prisma/migrations/20260817_add_teams/migration.sql",
    "apps/api/prisma/migrations/20260817_add_teams/rollback.md",
  ];
  const assessment = await assessChangedPrismaMigrations({ changedFiles, root });
  assert.equal(assessment.approved, true);
  assert.deepEqual(assessment.migrationFiles, [changedFiles[0]]);
});

test("fails closed when rollback, SQL or workflow evidence is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "crmynov-migration-policy-"));
  const changedFiles = ["apps/api/prisma/migrations/unknown/migration.sql"];
  const assessment = await assessChangedPrismaMigrations({ changedFiles, root });
  assert.equal(assessment.approved, false);
  assert.ok(assessment.reasons.includes("migration_rollback_document_missing"));
  assert.ok(assessment.reasons.includes("migration_file_unreadable"));
  assert.ok(assessment.reasons.includes("migration_workflow_unreadable"));
});

test("CI runner validates, deploys and checks status only on an ephemeral database", async () => {
  const calls = [];
  const result = await runMigrationCi({
    env: {
      DATABASE_URL: "postgresql://crm_policy:synthetic-only@127.0.0.1:5432/crm_policy",
      MIGRATION_BASE_SHA: "a".repeat(40),
      MIGRATION_HEAD_SHA: "b".repeat(40),
    },
    readWorkflow: async () => ephemeralWorkflow,
    listChangedFiles: () => [],
    assess: async () => ({ approved: true, reasons: [], migrationFiles: [] }),
    run: (command, arguments_) => calls.push([command, ...arguments_]),
  });
  assert.deepEqual(result, { approved: true, migrationCount: 0 });
  assert.deepEqual(calls.map((call) => call.slice(1, 3)), [
    ["prisma", "validate"],
    ["prisma", "migrate"],
    ["prisma", "migrate"],
  ]);
  await assert.rejects(
    runMigrationCi({
      env: { DATABASE_URL: "postgresql://crm_policy:x@persistent.example:5432/crm_policy", MIGRATION_BASE_SHA: "a", MIGRATION_HEAD_SHA: "b" },
      readWorkflow: async () => ephemeralWorkflow,
    }),
    /migration_ci_database_not_ephemeral/,
  );
});
