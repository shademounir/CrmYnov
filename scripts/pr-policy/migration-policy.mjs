import { readFile } from "node:fs/promises";
import { join } from "node:path";

const MIGRATION_SQL = /^apps\/api\/prisma\/migrations\/([^/]+)\/migration\.sql$/;
const ROLLBACK_DOC = /^apps\/api\/prisma\/migrations\/([^/]+)\/rollback\.md$/;
const SAFE_DEFAULT = /^(?:'[^']*'|[-+]?\d+(?:\.\d+)?|true|false|current_timestamp|now\(\)|gen_random_uuid\(\))$/i;
const FORBIDDEN_WORDS = new Set(["DROP", "TRUNCATE", "DELETE", "UPDATE", "INSERT"]);

function stable(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function result(reasons = [], details = {}) {
  return { approved: reasons.length === 0, reasons: stable(reasons), ...details };
}

function statements(sql) {
  return sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join(" ")
    .split(";")
    .map((statement) => statement.split(/\s+/).filter(Boolean).join(" ").trim())
    .filter(Boolean);
}

function words(statement) {
  return new Set(statement.toUpperCase().split(/[^A-Z_]+/).filter(Boolean));
}

function cleanIdentifier(value) {
  return String(value ?? "").replaceAll('"', "").toLowerCase();
}

function safeAddColumn(statement) {
  const upper = statement.toUpperCase();
  if (!upper.startsWith("ALTER TABLE ") || !upper.includes(" ADD COLUMN ") || upper.includes(" REFERENCES ")) return false;
  if (!upper.includes(" NOT NULL")) return true;
  const defaultAt = upper.indexOf(" DEFAULT ");
  if (defaultAt < 0) return false;
  const rawCandidate = statement.slice(defaultAt + 9).trim();
  const candidate = rawCandidate.toUpperCase().endsWith(" NOT NULL")
    ? rawCandidate.slice(0, -9).trim()
    : rawCandidate;
  return SAFE_DEFAULT.test(candidate);
}

function createdTables(items) {
  return new Set(items
    .filter((statement) => statement.toUpperCase().startsWith("CREATE TABLE "))
    .map((statement) => {
      const tokens = statement.split(" ");
      const offset = tokens.slice(2, 5).join(" ").toUpperCase().startsWith("IF NOT EXISTS") ? 5 : 2;
      return cleanIdentifier(tokens[offset]);
    }));
}

function statementReason(statement, newTables, uniquenessValidated) {
  const upper = statement.toUpperCase();
  const tokens = words(statement);
  if ([...FORBIDDEN_WORDS].some((word) => tokens.has(word))) return "migration_destructive_or_data_statement";
  if (tokens.has("RENAME") || (upper.includes("ALTER COLUMN") && (tokens.has("TYPE") || upper.includes(" SET NOT NULL")))) {
    return "migration_destructive_alteration";
  }
  if (upper.startsWith("CREATE TABLE ") || (upper.startsWith("CREATE TYPE ") && upper.includes(" AS ENUM"))) return undefined;
  if (upper.startsWith("CREATE UNIQUE INDEX ")) return uniquenessValidated ? undefined : "migration_unique_index_proof_missing";
  if (upper.startsWith("CREATE INDEX ") || safeAddColumn(statement) || (upper.startsWith("ALTER TYPE ") && upper.includes(" ADD VALUE"))) return undefined;
  if (upper.startsWith("ALTER TABLE ") && upper.includes(" ADD CONSTRAINT ") && upper.includes(" FOREIGN KEY ")) {
    return newTables.has(cleanIdentifier(statement.split(" ")[2])) ? undefined : "migration_sql_ambiguous";
  }
  return "migration_sql_ambiguous";
}

function hasSensitiveText(source) {
  const lower = source.toLowerCase();
  return ["postgres://", "postgresql://", "cloudsql", "googleapis.com", " gcp ", " staging ", " prod ", " production ", "password=", "token=", "credential", "secret"]
    .some((marker) => lower.includes(marker));
}

export function analyzeMigrationSql(sql) {
  const source = String(sql ?? "");
  const reasons = [];
  if (!source.trim()) reasons.push("migration_sql_empty");
  if (source.includes("/*") || source.includes("*/")) reasons.push("migration_sql_ambiguous");
  if (hasSensitiveText(` ${source} `)) reasons.push("migration_persistent_or_secret_reference");
  const lines = new Set(source.toLowerCase().split(/\r?\n/).map((line) => line.trim()));
  for (const marker of ["additive", "ephemeral-only", "rollback-documented"]) {
    if (!lines.has(`-- prisma-policy: ${marker}`)) reasons.push(`migration_marker_${marker}_missing`);
  }
  const items = statements(source);
  const newTables = createdTables(items);
  const uniquenessValidated = lines.has("-- prisma-policy: uniqueness-validated");
  reasons.push(...items.map((statement) => statementReason(statement, newTables, uniquenessValidated)).filter(Boolean));
  return result(reasons, { statementCount: items.length });
}

export function validateMigrationWorkflow(workflow) {
  const source = String(workflow ?? "");
  const lines = source.split(/\r?\n/).map((line) => line.trim());
  const lower = ` ${source.toLowerCase()} `;
  const reasons = [];
  if (!lines.includes("services:") || !lines.includes("postgres:")) reasons.push("migration_ephemeral_service_missing");
  if (!lines.some((line) => line.startsWith("image: postgres:"))) reasons.push("migration_ephemeral_postgres_missing");
  if (!lines.some((line) => line.startsWith("DATABASE_URL: postgresql://") && (line.includes("@127.0.0.1:5432/crm_policy") || line.includes("@localhost:5432/crm_policy")))) reasons.push("migration_local_database_url_missing");
  if (["${{ secrets.", "cloudsql", "googleapis.com", " gcp ", " staging ", " prod ", " production "].some((marker) => lower.includes(marker))) reasons.push("migration_workflow_persistent_or_secret_reference");
  if (!lines.includes("persist-credentials: false")) reasons.push("migration_workflow_credentials_persisted");
  return result(reasons);
}

export async function assessChangedPrismaMigrations({ changedFiles = [], root = process.cwd(), workflowPath = ".github/workflows/prisma-migration-policy.yml" } = {}) {
  const migrationFiles = changedFiles.filter((file) => MIGRATION_SQL.test(file));
  const migrationPaths = changedFiles.filter((file) => MIGRATION_SQL.test(file) || ROLLBACK_DOC.test(file));
  if (!migrationPaths.length) return result([], { applicable: false, migrationFiles: [] });
  const reasons = [];
  if (!migrationFiles.length) reasons.push("migration_sql_missing");
  for (const file of migrationFiles) {
    const id = MIGRATION_SQL.exec(file)?.[1];
    if (!changedFiles.includes(`apps/api/prisma/migrations/${id}/rollback.md`)) reasons.push("migration_rollback_document_missing");
    try {
      reasons.push(...analyzeMigrationSql(await readFile(join(root, file), "utf8")).reasons);
    } catch {
      reasons.push("migration_file_unreadable");
    }
  }
  try {
    reasons.push(...validateMigrationWorkflow(await readFile(join(root, workflowPath), "utf8")).reasons);
  } catch {
    reasons.push("migration_workflow_unreadable");
  }
  return result(reasons, { applicable: true, migrationFiles: stable(migrationFiles) });
}

export { MIGRATION_SQL, ROLLBACK_DOC };
