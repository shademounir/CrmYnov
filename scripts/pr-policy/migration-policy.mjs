import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { recognizedForeignKeyWords, sqlStatements, statementText, structuredAddColumn } from "./migration-grammar.mjs";

const MIGRATION_SQL = /^apps\/api\/prisma\/migrations\/([^/]+)\/migration\.sql$/;
const ROLLBACK_DOC = /^apps\/api\/prisma\/migrations\/([^/]+)\/rollback\.md$/;
const POLICY_EVIDENCE = /^apps\/api\/prisma\/migrations\/([^/]+)\/policy\.json$/;
const FORBIDDEN_WORDS = new Set(["DROP", "TRUNCATE", "DELETE", "UPDATE", "INSERT"]);
const REQUIRED_MARKERS = ["additive", "ephemeral-only", "rollback-documented"];

function stable(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function result(reasons = [], details = {}) {
  return { approved: reasons.length === 0, reasons: stable(reasons), ...details };
}

function cleanIdentifier(value) {
  return String(value ?? "").replaceAll('"', "").toLowerCase();
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

function safeVarcharWidening(lexemes, evidence) {
  const words = lexemes.map((token) => token.kind === "word" ? token.value.toUpperCase() : token.value);
  if (
    words.length !== 11 || words[0] !== "ALTER" || words[1] !== "TABLE" ||
    words[3] !== "ALTER" || words[4] !== "COLUMN" || words[6] !== "TYPE" ||
    words[7] !== "VARCHAR" || words[8] !== "(" || words[10] !== ")"
  ) return false;
  const candidate = evidence?.safeTypeChanges?.find((change) =>
    change.kind === "varchar-widening" &&
    cleanIdentifier(change.table) === cleanIdentifier(lexemes[2]?.value) &&
    cleanIdentifier(change.column) === cleanIdentifier(lexemes[5]?.value) &&
    Number(change.toLength) === Number(lexemes[9]?.value) &&
    Number.isInteger(Number(change.fromLength)) &&
    Number(change.fromLength) > 0 &&
    Number(change.toLength) > Number(change.fromLength) &&
    typeof change.lockRisk === "string" && change.lockRisk.trim().length > 0 &&
    typeof change.dataRisk === "string" && change.dataRisk.trim().length > 0
  );
  return Boolean(candidate);
}

function statementReason(lexemes, newTables, uniquenessValidated, evidence) {
  const statement = statementText(lexemes);
  const upper = statement.toUpperCase();
  const allowedActions = recognizedForeignKeyWords(lexemes);
  const tokens = new Set(lexemes.filter(token => token.kind === "word" && !allowedActions.has(token)).map(token => token.value.toUpperCase()));
  if ([...FORBIDDEN_WORDS].some((word) => tokens.has(word))) return "migration_destructive_or_data_statement";
  if (tokens.has("RENAME") || (upper.includes("ALTER COLUMN") && upper.includes(" SET NOT NULL"))) {
    return "migration_destructive_alteration";
  }
  if (upper.includes("ALTER COLUMN") && tokens.has("TYPE")) return safeVarcharWidening(lexemes, evidence) ? undefined : "migration_destructive_alteration";
  if (upper.startsWith("CREATE TABLE ") || (upper.startsWith("CREATE TYPE ") && upper.includes(" AS ENUM"))) return undefined;
  if (upper.startsWith("CREATE UNIQUE INDEX ")) return uniquenessValidated ? undefined : "migration_unique_index_proof_missing";
  if (upper.startsWith("CREATE INDEX ") || structuredAddColumn(lexemes) || (upper.startsWith("ALTER TYPE ") && upper.includes(" ADD VALUE"))) return undefined;
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

export function analyzeMigrationSql(sql, evidence = undefined) {
  const source = String(sql ?? "");
  const reasons = [];
  if (!source.trim()) reasons.push("migration_sql_empty");
  if (source.includes("/*") || source.includes("*/")) reasons.push("migration_sql_ambiguous");
  if (hasSensitiveText(` ${source} `)) reasons.push("migration_persistent_or_secret_reference");
  const lines = new Set(source.toLowerCase().split(/\r?\n/).map((line) => line.trim()));
  const evidenceMarkers = new Set(Array.isArray(evidence?.markers) ? evidence.markers.map((marker) => String(marker).toLowerCase()) : []);
  for (const marker of REQUIRED_MARKERS) {
    if (!lines.has(`-- prisma-policy: ${marker}`) && !evidenceMarkers.has(marker)) reasons.push(`migration_marker_${marker}_missing`);
  }
  let items;
  try { items = sqlStatements(source); }
  catch { return result([...reasons, "migration_sql_ambiguous"], { statementCount: 0 }); }
  const newTables = createdTables(items.map(statementText));
  const uniquenessValidated = lines.has("-- prisma-policy: uniqueness-validated") || evidenceMarkers.has("uniqueness-validated");
  reasons.push(...items.map((statement) => statementReason(statement, newTables, uniquenessValidated, evidence)).filter(Boolean));
  return result(reasons, { statementCount: items.length });
}

function migrationSha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function validatePolicyEvidence(evidence, { id, sql }) {
  const reasons = [];
  if (evidence?.schemaVersion !== 1 || evidence?.migration !== id) reasons.push("migration_policy_evidence_invalid");
  if (evidence?.migrationSha256 !== migrationSha256(sql)) reasons.push("migration_policy_evidence_checksum_mismatch");
  if (!Array.isArray(evidence?.markers) || evidence.markers.some((marker) => typeof marker !== "string")) reasons.push("migration_policy_evidence_invalid");
  return result(reasons);
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
  const migrationPaths = changedFiles.filter((file) => MIGRATION_SQL.test(file) || ROLLBACK_DOC.test(file) || POLICY_EVIDENCE.test(file));
  if (!migrationPaths.length) return result([], { applicable: false, migrationFiles: [] });
  const reasons = [];
  if (!migrationFiles.length) reasons.push("migration_sql_missing");
  for (const file of migrationFiles) {
    const id = MIGRATION_SQL.exec(file)?.[1];
    const rollbackFile = `apps/api/prisma/migrations/${id}/rollback.md`;
    const evidenceFile = `apps/api/prisma/migrations/${id}/policy.json`;
    if (!changedFiles.includes(rollbackFile)) reasons.push("migration_rollback_document_missing");
    try {
      const sql = await readFile(join(root, file), "utf8");
      let evidence;
      if (changedFiles.includes(evidenceFile)) {
        try {
          evidence = JSON.parse(await readFile(join(root, evidenceFile), "utf8"));
          const evidenceAssessment = validatePolicyEvidence(evidence, { id, sql });
          reasons.push(...evidenceAssessment.reasons);
          if (!evidenceAssessment.approved) evidence = undefined;
        } catch {
          reasons.push("migration_policy_evidence_invalid");
        }
      }
      reasons.push(...analyzeMigrationSql(sql, evidence).reasons);
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

export { MIGRATION_SQL, POLICY_EVIDENCE, ROLLBACK_DOC };
