import { createHash, randomBytes, scryptSync } from "node:crypto";
import { runtimeDatabaseTarget, type RuntimeDatabaseTarget } from "./runtime-database-target.js";

export const INITIAL_ADMIN_EVENT = "INITIAL_ADMIN_BOOTSTRAPPED";
export const INITIAL_ADMIN_GRANT = "crm-ynov-po-delegation-20261001";
export const INITIAL_ADMIN_MIGRATIONS = 52;

export interface InitialAdminInput {
  enabled?: string | undefined;
  environment?: string | undefined;
  project?: string | undefined;
  database?: string | undefined;
  observedProject?: string | undefined;
  email?: string | undefined;
  displayName?: string | undefined;
  operationId?: string | undefined;
  decisionSha256?: string | undefined;
  sourceSha?: string | undefined;
  secretVersion?: string | undefined;
  temporarySecret?: string | undefined;
  delegation?: string | undefined;
}

export interface InitialAdminConfiguration {
  target: RuntimeDatabaseTarget;
  email: string;
  displayName: string;
  operationId: string;
  decisionSha256: string;
  sourceSha: string;
  secretVersion: string;
  temporarySecret: string;
  idempotencyKey: string;
  configurationHash: string;
}

export function initialAdminConfiguration(input: InitialAdminInput): InitialAdminConfiguration {
  if (input.enabled !== "true" || input.delegation !== INITIAL_ADMIN_GRANT ||
    !input.database || !input.project || !input.observedProject || !["staging", "prod"].includes(input.environment ?? "")) {
    throw new Error("initial_admin_configuration_invalid");
  }
  const target = runtimeDatabaseTarget({ databaseName: input.database, databaseEnvironment: input.environment,
    databaseProject: input.project, observedProject: input.observedProject });
  const { email, displayName, operationId, decisionSha256, sourceSha, secretVersion, temporarySecret } = input;
  if (typeof email !== "string" || email !== email.trim().toLowerCase() || email.length > 254 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/u.test(email) ||
    typeof displayName !== "string" || displayName !== displayName.trim() || displayName.length < 2 || displayName.length > 120 ||
    [...displayName].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
    typeof operationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(operationId) ||
    typeof decisionSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(decisionSha256) ||
    typeof sourceSha !== "string" || !/^[a-f0-9]{40}$/u.test(sourceSha) || typeof secretVersion !== "string" ||
    !new RegExp(`^projects/${target.project}/secrets/crm-${target.environment}-initial-admin/versions/[1-9][0-9]{0,8}$`, "u").test(secretVersion) ||
    typeof temporarySecret !== "string" || temporarySecret.length < 32 || temporarySecret.length > 128 ||
    !/^[\x21-\x7e]+$/u.test(temporarySecret) || !/[a-z]/u.test(temporarySecret) || !/[A-Z]/u.test(temporarySecret) || !/[0-9]/u.test(temporarySecret) || !/[^a-zA-Z0-9]/u.test(temporarySecret)) {
    throw new Error("initial_admin_configuration_invalid");
  }
  // The approved STAGING principal is explicit; it is never a PROD fallback.
  if (target.environment === "staging" && (email !== "admin-staging@example.invalid" || displayName !== "Admin synthétique STAGING") ||
    target.environment === "prod" && email.endsWith("@example.invalid")) throw new Error("initial_admin_identity_not_authorized");
  const identity = { target, email, displayName, operationId, decisionSha256, sourceSha, secretVersion,
    delegation: INITIAL_ADMIN_GRANT, executor: "Codex", roles: ["SUPER_ADMIN"], firstLoginRequired: true };
  return { ...identity, temporarySecret, idempotencyKey: `initial-admin:${target.project}`,
    configurationHash: createHash("sha256").update(JSON.stringify(identity)).digest("hex") };
}

export function initialAdminPassword(secret: string): { identitySalt: string; passwordDigest: string } {
  // Same persisted scrypt(secret, hex salt, 32) contract as LocalCredentialAdapter.
  const identitySalt = randomBytes(16).toString("hex");
  return { identitySalt, passwordDigest: scryptSync(secret, identitySalt, 32).toString("hex") };
}

export function initialAdminInput(environment: NodeJS.ProcessEnv): InitialAdminInput {
  return {
    enabled: environment.CRM_INITIAL_ADMIN_ENABLED, environment: environment.CRM_RUNTIME_DATABASE_ENVIRONMENT,
    project: environment.CRM_RUNTIME_DATABASE_PROJECT, database: environment.CRM_RUNTIME_DATABASE_NAME,
    observedProject: environment.GOOGLE_CLOUD_PROJECT ?? environment.GCLOUD_PROJECT,
    email: environment.CRM_INITIAL_ADMIN_EMAIL, displayName: environment.CRM_INITIAL_ADMIN_DISPLAY_NAME,
    operationId: environment.CRM_INITIAL_ADMIN_OPERATION_ID, decisionSha256: environment.CRM_INITIAL_ADMIN_DECISION_SHA256,
    sourceSha: environment.CRM_INITIAL_ADMIN_SOURCE_SHA, secretVersion: environment.CRM_INITIAL_ADMIN_SECRET_VERSION,
    temporarySecret: environment.CRM_INITIAL_ADMIN_TEMPORARY_SECRET, delegation: environment.CRM_INITIAL_ADMIN_DELEGATION,
  };
}
