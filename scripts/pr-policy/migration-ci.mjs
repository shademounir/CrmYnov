import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assessChangedPrismaMigrations, validateMigrationWorkflow } from "./migration-policy.mjs";

function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export async function runMigrationCi({
  env = process.env,
  readWorkflow = () => readFile(".github/workflows/prisma-migration-policy.yml", "utf8"),
  changedFiles = [],
  assess = assessChangedPrismaMigrations,
} = {}) {
  required(env, "MIGRATION_BASE_SHA");
  required(env, "MIGRATION_HEAD_SHA");
  const databaseUrl = new URL(required(env, "DATABASE_URL"));
  if (
    databaseUrl.protocol !== "postgresql:" ||
    !["127.0.0.1", "localhost"].includes(databaseUrl.hostname) ||
    databaseUrl.port !== "5432" ||
    databaseUrl.pathname !== "/crm_policy"
  ) {
    throw new Error("migration_ci_database_not_ephemeral");
  }

  const workflowAssessment = validateMigrationWorkflow(await readWorkflow());
  if (!workflowAssessment.approved) throw new Error(`migration_workflow_refused:${workflowAssessment.reasons.join(",")}`);
  const migrationAssessment = await assess({ changedFiles });
  if (!migrationAssessment.approved) throw new Error(`migration_static_audit_refused:${migrationAssessment.reasons.join(",")}`);
  return { approved: true, migrationCount: migrationAssessment.migrationFiles.length };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = await runMigrationCi({ changedFiles: process.argv.slice(2) });
  process.stdout.write(`Prisma migration policy passed (${result.migrationCount} changed migration file(s)); target is ephemeral.\n`);
}
