import { PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { assertRuntimeDatabaseIdentity } from "./runtime-database-target.js";
import { INITIAL_ADMIN_EVENT, INITIAL_ADMIN_GRANT, INITIAL_ADMIN_MIGRATIONS, initialAdminConfiguration,
  initialAdminInput, initialAdminPassword, type InitialAdminConfiguration, type InitialAdminInput } from "./initial-admin-contract.js";

export interface InitialAdminTransaction {
  $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}
export interface InitialAdminClient {
  $transaction<T>(work: (transaction: InitialAdminTransaction) => Promise<T>, options: { isolationLevel: "Serializable"; maxWait: number; timeout: number }): Promise<T>;
  $disconnect(): Promise<void>;
}
export interface InitialAdminDependencies {
  input: InitialAdminInput;
  createClient(): InitialAdminClient;
  write(message: string): void;
}
export interface InitialAdminResult { completed: true; replayed: boolean; subjectId: string; operationId: string; configurationHash: string }

function rows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || !value.every((row: unknown) => row !== null && typeof row === "object")) throw new Error("initial_admin_database_proof_invalid");
  return value as Array<Record<string, unknown>>;
}

async function provision(transaction: InitialAdminTransaction, configuration: InitialAdminConfiguration): Promise<InitialAdminResult> {
  const identity = rows(await transaction.$queryRaw`SELECT current_database() AS "databaseName", current_user AS "databaseUser"`);
  assertRuntimeDatabaseIdentity(identity, configuration.target);
  if (identity[0]?.databaseUser !== "crm_migrator") throw new Error("initial_admin_database_role_invalid");
  await transaction.$executeRaw`SET LOCAL lock_timeout = '5s'`;
  await transaction.$executeRaw`SET LOCAL statement_timeout = '60s'`;
  // No bootstrap can race another identity/credential/audit writer. No global application lock is claimed.
  await transaction.$executeRaw`LOCK TABLE collaborators, local_password_hashes, audit_events IN SHARE ROW EXCLUSIVE MODE`;
  const migrations = rows(await transaction.$queryRaw`SELECT
    count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::integer AS "completed",
    count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::integer AS "unfinished"
    FROM "_prisma_migrations"`);
  if (migrations.length !== 1 || migrations[0]?.completed !== INITIAL_ADMIN_MIGRATIONS || migrations[0]?.unfinished !== 0) throw new Error("initial_admin_migrations_unqualified");
  const previous = rows(await transaction.$queryRaw`SELECT resource_id AS "subjectId", after, result, event_type AS "eventType"
    FROM audit_events WHERE idempotency_key = ${configuration.idempotencyKey}`);
  if (previous.length !== 0) {
    const receipt = previous[0], after = receipt?.after;
    if (previous.length !== 1 || receipt?.eventType !== INITIAL_ADMIN_EVENT || receipt.result !== "SUCCESS" ||
      typeof receipt.subjectId !== "string" || !after || typeof after !== "object" ||
      !("configurationHash" in after) || after.configurationHash !== configuration.configurationHash) throw new Error("initial_admin_already_initialized");
    const identityDigest = createHash("sha256").update(configuration.email).digest("hex");
    const persisted = rows(await transaction.$queryRaw`SELECT c.id FROM collaborators c JOIN local_password_hashes p ON p.collaborator_id=c.id
      WHERE c.id::text=${receipt.subjectId} AND c.professional_email=${configuration.email} AND p.identity_digest=${identityDigest}`);
    if (persisted.length !== 1 || persisted[0]?.id !== receipt.subjectId) throw new Error("initial_admin_receipt_integrity_invalid");
    return { completed: true, replayed: true, subjectId: receipt.subjectId, operationId: configuration.operationId, configurationHash: configuration.configurationHash };
  }
  const occupancy = rows(await transaction.$queryRaw`SELECT
    (SELECT count(*)::integer FROM collaborators) AS collaborators,
    (SELECT count(*)::integer FROM local_password_hashes) AS credentials,
    (SELECT count(*)::integer FROM audit_events WHERE event_type = ${INITIAL_ADMIN_EVENT}) AS bootstraps`);
  if (occupancy.length !== 1 || occupancy[0]?.collaborators !== 0 || occupancy[0]?.credentials !== 0 || occupancy[0]?.bootstraps !== 0) throw new Error("initial_admin_already_initialized");
  const subjectId = randomUUID(), passwordId = randomUUID(), auditId = randomUUID();
  const identityDigest = createHash("sha256").update(configuration.email).digest("hex");
  const { identitySalt, passwordDigest } = initialAdminPassword(configuration.temporarySecret);
  await transaction.$executeRaw`INSERT INTO collaborators
    (id,professional_email,professional_display_name,roles,active,first_login_required,authentication_version,created_at,updated_at)
    VALUES (${subjectId}::uuid,${configuration.email},${configuration.displayName},ARRAY['SUPER_ADMIN']::text[],true,true,1,now(),now())`;
  await transaction.$executeRaw`INSERT INTO local_password_hashes
    (id,collaborator_id,identity_digest,password_salt,password_digest,must_change,created_at,updated_at)
    VALUES (${passwordId}::uuid,${subjectId}::uuid,${identityDigest},${identitySalt},${passwordDigest},true,now(),now())`;
  const after = JSON.stringify({ schemaVersion: 1, subjectId, configurationHash: configuration.configurationHash,
    target: configuration.target, operationId: configuration.operationId, decisionSha256: configuration.decisionSha256,
    sourceSha: configuration.sourceSha, secretVersion: configuration.secretVersion, executor: "Codex", delegation: INITIAL_ADMIN_GRANT,
    roles: ["SUPER_ADMIN"], active: true, firstLoginRequired: true, humanReviewClaimed: false });
  await transaction.$executeRaw`INSERT INTO audit_events
    (id,resource_type,resource_id,event_type,actor_id,actor_roles,correlation_id,after,result,idempotency_key)
    VALUES (${auditId}::uuid,'COLLABORATOR',${subjectId},${INITIAL_ADMIN_EVENT},NULL,ARRAY[]::text[],${configuration.operationId},${after}::jsonb,'SUCCESS',${configuration.idempotencyKey})`;
  return { completed: true, replayed: false, subjectId, operationId: configuration.operationId, configurationHash: configuration.configurationHash };
}

export async function runInitialAdminBootstrap(dependencies: InitialAdminDependencies = {
  input: initialAdminInput(process.env), createClient: () => new PrismaClient(), write: (message) => process.stdout.write(message),
}): Promise<InitialAdminResult> {
  const configuration = initialAdminConfiguration(dependencies.input);
  const client = dependencies.createClient();
  let result: InitialAdminResult | undefined, failure: unknown;
  try {
    result = await client.$transaction((transaction) => provision(transaction, configuration), { isolationLevel: "Serializable", maxWait: 5000, timeout: 65000 });
  } catch (error: unknown) { failure = error; }
  try { await client.$disconnect(); } catch (error: unknown) { failure ??= error; }
  if (failure !== undefined) throw failure instanceof Error ? failure : new Error("initial_admin_operation_failed_reconcile_before_retry", { cause: failure });
  if (!result) throw new Error("initial_admin_result_unavailable");
  dependencies.write(`${JSON.stringify({ job: "bootstrap-initial-admin", ...result })}\n`);
  return result;
}

export function initialAdminFailure(error: unknown): string {
  const allowed = new Set(["initial_admin_configuration_invalid", "initial_admin_identity_not_authorized", "crm_runtime_database_target_invalid",
    "crm_runtime_database_target_mismatch", "initial_admin_database_role_invalid", "initial_admin_migrations_unqualified",
    "initial_admin_database_proof_invalid", "initial_admin_already_initialized", "initial_admin_result_unavailable", "initial_admin_receipt_integrity_invalid"]);
  const code = error instanceof Error && allowed.has(error.message) ? error.message : "initial_admin_operation_failed_reconcile_before_retry";
  return `${JSON.stringify({ job: "bootstrap-initial-admin", completed: false, code })}\n`;
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/jobs/bootstrap-initial-admin.js")) {
  void runInitialAdminBootstrap().catch((error: unknown) => {
    process.stderr.write(initialAdminFailure(error)); process.exitCode = 1;
  });
}
