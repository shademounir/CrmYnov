import { createHash } from "node:crypto";

export const EXPECTED = Object.freeze({
  organizationId: "1046537507934",
  bootstrapProjectId: "crmynov-bst-n7x4q2",
  region: "europe-southwest1",
  humanIdentity: "casablancaynovcampus@gmail.com",
  projectAddress: "google_project.bootstrap",
  services: Object.freeze([
    "cloudbilling.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
  ]),
  labels: Object.freeze({
    application: "crm-ynov",
    environment: "bootstrap",
    "managed-by": "terraform",
    owner: "admissions",
    phase: "phase-0",
  }),
});

export class ContractError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function refuse(code) {
  throw new ContractError(code);
}

function exactObject(actual, expected, code) {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) refuse(code);
  if (JSON.stringify(Object.keys(actual).sort()) !== JSON.stringify(Object.keys(expected).sort())) refuse(code);
  for (const [key, value] of Object.entries(expected)) if (actual[key] !== value) refuse(code);
}

function assertSafe(value) {
  const serialized = JSON.stringify(value);
  const forbidden = [
    /refresh[_-]?token/i,
    /access[_-]?token/i,
    /client[_-]?secret/i,
    /authorization/i,
    /private[_-]?key/i,
    /[A-F0-9]{6}-[A-F0-9]{6}-[A-F0-9]{6}/i,
  ];
  if (forbidden.some((pattern) => pattern.test(serialized))) refuse("sensitive_output");
}

function validateState(input) {
  if (input.observed?.quotaProjectConfigured === true && input.observed?.projectExists !== true) {
    refuse("quota_before_project_exists");
  }
  if (input.observed?.projectExists !== true) refuse("project_absent");
  if (input.observed?.projectId !== EXPECTED.bootstrapProjectId) refuse("observed_project_id_mismatch");
  if (input.observed?.organizationId !== EXPECTED.organizationId) refuse("observed_organization_mismatch");
  if (input.observed?.lifecycleState !== "ACTIVE") refuse("project_lifecycle_invalid");
  if (input.import?.explicitlyAuthorized !== true) refuse("import_not_authorized");
  if (input.import?.projectImported !== true) refuse("plan_before_import");
  if (input.import?.projectAddress !== EXPECTED.projectAddress) refuse("project_import_address_mismatch");
  if (!Array.isArray(input.import?.serviceAddresses) || input.import.serviceAddresses.length !== EXPECTED.services.length) {
    refuse("service_imports_incomplete");
  }
  if (input.import?.otherStateContainsProject === true) refuse("project_in_other_state");
  if (input.terraformOwners?.bootstrapProject !== "phase0" || input.terraformOwners?.foundationOwnsBootstrapProject !== false) {
    refuse("terraform_ownership_conflict");
  }
  if (input.foundation?.createsBootstrap === true || input.foundation?.importsBootstrap === true) {
    refuse("foundation_bootstrap_ownership_forbidden");
  }
  if (input.observed?.quotaProjectConfigured === true && input.observed?.serviceUsagePermission !== true) {
    refuse("serviceusage_permission_missing");
  }
}

export function analyzePhase0Contract(input, { mode, now = new Date().toISOString() } = {}) {
  if (!["SyntheticFixture", "ContractSimulation"].includes(mode)) refuse("mode_forbidden");
  if (!input || typeof input !== "object" || Array.isArray(input)) refuse("input_invalid");
  if (input.organizationId !== EXPECTED.organizationId) refuse("organization_mismatch");
  if (input.bootstrapProjectId !== EXPECTED.bootstrapProjectId) refuse("project_id_mismatch");
  if (input.region !== EXPECTED.region) refuse("region_mismatch");
  if (input.humanIdentity !== EXPECTED.humanIdentity) refuse("identity_mismatch");
  if (!/^[0-9a-f]{40}$/.test(input.gitSha ?? "")) refuse("git_sha_invalid");
  if (input.billingAccountPresent !== true) refuse("billing_account_missing");
  exactObject(input.labels, EXPECTED.labels, "labels_mismatch");
  if (!Array.isArray(input.services)) refuse("services_invalid");
  const actualServices = [...new Set(input.services)].sort();
  if (actualServices.length !== input.services.length) refuse("service_duplicate");
  if (JSON.stringify(actualServices) !== JSON.stringify([...EXPECTED.services].sort())) refuse("service_allowlist_mismatch");
  if (input.partialExecution === true) refuse("partial_execution_detected");
  if (input.concurrentInvocation === true || input.previousAttempt === true) refuse("single_attempt_violation");
  validateState(input);
  if (input.observed?.cleanupSucceeded !== true) refuse("cleanup_failed");

  const evidence = {
    schemaVersion: 2,
    mode,
    gitSha: input.gitSha,
    projectId: EXPECTED.bootstrapProjectId,
    expectedParent: input.bootstrapParentFolderId ? "folder" : "organization",
    projectExists: true,
    projectImported: true,
    serviceImportsComplete: true,
    billingActive: Boolean(input.observed.billingActive),
    expectedApis: [...EXPECTED.services],
    quotaProjectConfigured: Boolean(input.observed.quotaProjectConfigured),
    adcPresent: Boolean(input.observed.adcPresent),
    identityVerified: Boolean(input.observed.identityVerified),
    operationEstimates: {
      proceduralProjectCreates: 1,
      terraformImports: 4,
      phase0PlanCreatesIndicative: 1,
      phase0PlanChanges: "unknown-until-real-plan-json",
      phase1PlanCreatesIndicative: 26,
      consolidatedManagedResourcesTarget: 31,
      countersValidatedByRealPlan: false,
    },
    startedAtUtc: input.startedAtUtc,
    completedAtUtc: now,
    mutated: false,
    cleanupSucceeded: true,
    rollbackRequired: false,
    contractSha256: createHash("sha256").update(JSON.stringify({
      organizationId: input.organizationId,
      bootstrapProjectId: input.bootstrapProjectId,
      gitSha: input.gitSha,
      services: actualServices,
      projectAddress: input.import.projectAddress,
    })).digest("hex"),
  };
  if (!/^\d{4}-\d{2}-\d{2}T/.test(evidence.startedAtUtc ?? "")) refuse("start_timestamp_invalid");
  if (Date.parse(evidence.startedAtUtc) > Date.parse(evidence.completedAtUtc)) refuse("timestamp_order_invalid");
  assertSafe(evidence);
  return evidence;
}

export function publicFailure(error) {
  return {
    schemaVersion: 2,
    valid: false,
    errorCode: error instanceof ContractError ? error.code : "internal_error",
    mutated: false,
    cleanupSucceeded: true,
    rollbackRequired: false,
  };
}
