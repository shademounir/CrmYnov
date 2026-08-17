import { readFile } from "node:fs/promises";
import { join } from "node:path";

const MIGRATION_SQL = /^apps\/api\/prisma\/migrations\/([^/]+)\/migration\.sql$/;
const ROLLBACK_DOC = /^apps\/api\/prisma\/migrations\/([^/]+)\/rollback\.md$/;
const SAFE_DEFAULT = /^(?:'[^']*'|[-+]?\d+(?:\.\d+)?|true|false|current_timestamp|now\(\)|gen_random_uuid\(\))$/i;
const SENSITIVE_TEXT = /(?:postgres(?:ql)?:\/\/|cloudsql|googleapis\.com|\bgcp\b|\bstaging\b|\bprod(?:uction)?\b|password\s*=|token\s*=|credential|secret)/i;

function result(reasons = [], details = {}) {
  return {
    approved: reasons.length === 0,
    reasons: [...new Set(reasons)].sort(),
    ...details,
  };
}

function statements(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*--.*$/gm, " ")
    .split(";")
    .map((statement) => statement.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function safeAddColumn(statement) {
  if (!/^ALTER TABLE\s+[^ ]+\s+ADD COLUMN\s+/i.test(statement)) return false;
  if (/\bREFERENCES\b/i.test(statement)) return false;
  if (!/\bNOT NULL\b/i.test(statement)) return true;
  const match = /\bDEFAULT\s+(.+?)(?:\s+NOT NULL)?$/i.exec(statement);
  return Boolean(match && SAFE_DEFAULT.test(match[1].trim()));
}

function createdTables(items) {
  return new Set(items.flatMap((statement) => {
    const match = /^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?("?[A-Za-z_][\w$]*"?(?:\."?[A-Za-z_][\w$]*"?)?)/i.exec(statement);
    return match ? [match[1].replaceAll('"', "").toLowerCase()] : [];
  }));
}

export function analyzeMigrationSql(sql) {
  const reasons = [];
  const source = String(sql ?? "");
  if (!source.trim()) reasons.push("migration_sql_empty");
  if (SENSITIVE_TEXT.test(source)) reasons.push("migration_persistent_or_secret_reference");
  for (const marker of ["additive", "ephemeral-only", "rollback-documented"]) {
    if (!new RegExp(`^\\s*--\\s*prisma-policy:\\s*${marker}\\s*$`, "im").test(source)) {
      reasons.push(`migration_marker_${marker}_missing`);
    }
  }

  const items = statements(source);
  const newTables = createdTables(items);
  for (const statement of items) {
    if (/\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/i.test(statement)) {
      reasons.push("migration_destructive_or_data_statement");
      continue;
    }
    if (/\bRENAME\b|ALTER\s+(?:TABLE|COLUMN)[\s\S]*\bTYPE\b|ALTER\s+COLUMN[\s\S]*\bSET\s+NOT\s+NULL\b/i.test(statement)) {
      reasons.push("migration_destructive_alteration");
      continue;
    }
    if (/^CREATE TABLE\b/i.test(statement) || /^CREATE TYPE\b[\s\S]*\bAS ENUM\b/i.test(statement)) continue;
    if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(statement)) {
      if (/^CREATE\s+UNIQUE\s+INDEX\b/i.test(statement) && !/prisma-policy:\s*uniqueness-validated/i.test(source)) {
        reasons.push("migration_unique_index_proof_missing");
      }
      continue;
    }
    if (safeAddColumn(statement)) continue;
    if (/^ALTER TYPE\s+[^ ]+\s+ADD VALUE\b/i.test(statement)) continue;
    const foreignKey = /^ALTER TABLE\s+("?[A-Za-z_][\w$]*"?(?:\."?[A-Za-z_][\w$]*"?)?)\s+ADD CONSTRAINT\s+[^ ]+\s+FOREIGN KEY\b/i.exec(statement);
    if (foreignKey && newTables.has(foreignKey[1].replaceAll('"', "").toLowerCase())) continue;
    reasons.push("migration_sql_ambiguous");
  }
  return result(reasons, { statementCount: items.length });
}

export function validateMigrationWorkflow(workflow) {
  const source = String(workflow ?? "");
  const reasons = [];
  if (!/^\s*services:\s*$/m.test(source) || !/^\s*postgres:\s*$/m.test(source)) reasons.push("migration_ephemeral_service_missing");
  if (!/image:\s*postgres:[^\s]+/i.test(source)) reasons.push("migration_ephemeral_postgres_missing");
  if (!/DATABASE_URL:\s*postgresql:\/\/[^\s]+@(?:127\.0\.0\.1|localhost):5432\//i.test(source)) reasons.push("migration_local_database_url_missing");
  if (/\$\{\{\s*secrets\.|cloudsql|googleapis\.com|\bgcp\b|\bstaging\b|\bprod(?:uction)?\b/i.test(source)) reasons.push("migration_workflow_persistent_or_secret_reference");
  if (!/persist-credentials:\s*false/i.test(source)) reasons.push("migration_workflow_credentials_persisted");
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
      const analysis = analyzeMigrationSql(await readFile(join(root, file), "utf8"));
      reasons.push(...analysis.reasons);
    } catch {
      reasons.push("migration_file_unreadable");
    }
  }
  try {
    const workflow = await readFile(join(root, workflowPath), "utf8");
    reasons.push(...validateMigrationWorkflow(workflow).reasons);
  } catch {
    reasons.push("migration_workflow_unreadable");
  }
  return result(reasons, { applicable: true, migrationFiles: [...migrationFiles].sort() });
}

export { MIGRATION_SQL, ROLLBACK_DOC };
