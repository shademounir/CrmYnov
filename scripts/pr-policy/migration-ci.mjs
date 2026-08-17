import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assessChangedPrismaMigrations, validateMigrationWorkflow } from "./migration-policy.mjs";

function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function defaultChangedFiles(baseSha, headSha) {
  return execFileSync("git", ["diff", "--name-only", baseSha, headSha], { encoding: "utf8" })
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean);
}

function defaultRun(command, arguments_, env) {
  execFileSync(command, arguments_, { stdio: ["ignore", "inherit", "inherit"], env });
}

export async function runMigrationCi({
  env = process.env,
  readWorkflow = () => readFile(".github/workflows/prisma-migration-policy.yml", "utf8"),
  listChangedFiles = defaultChangedFiles,
  assess = assessChangedPrismaMigrations,
  run = defaultRun,
} = {}) {
  const baseSha = required(env, "MIGRATION_BASE_SHA");
  const headSha = required(env, "MIGRATION_HEAD_SHA");
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
  const migrationAssessment = await assess({ changedFiles: listChangedFiles(baseSha, headSha) });
  if (!migrationAssessment.approved) throw new Error(`migration_static_audit_refused:${migrationAssessment.reasons.join(",")}`);

  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const schema = "apps/api/prisma/schema.prisma";
  run(npx, ["prisma", "validate", "--schema", schema], env);
  run(npx, ["prisma", "migrate", "deploy", "--schema", schema], env);
  run(npx, ["prisma", "migrate", "status", "--schema", schema], env);
  return { approved: true, migrationCount: migrationAssessment.migrationFiles.length };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = await runMigrationCi();
  process.stdout.write(`Prisma migration policy passed (${result.migrationCount} changed migration file(s)); target is ephemeral.\n`);
}
