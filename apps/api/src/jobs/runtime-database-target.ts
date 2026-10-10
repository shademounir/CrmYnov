export interface RuntimeDatabaseTargetInput {
  databaseName?: string | undefined;
  databaseEnvironment?: string | undefined;
  databaseProject?: string | undefined;
  observedProject?: string | undefined;
}

export interface RuntimeDatabaseTarget {
  databaseName: "crmynov_dev" | "crmynov_stg" | "crmynov_prod";
  environment: "dev" | "staging" | "prod";
  project: "crmynov-dev-n7x4q2" | "crmynov-stg-n7x4q2" | "crmynov-prod-n7x4q2";
}

const targets: readonly RuntimeDatabaseTarget[] = [
  { databaseName: "crmynov_dev", environment: "dev", project: "crmynov-dev-n7x4q2" },
  { databaseName: "crmynov_stg", environment: "staging", project: "crmynov-stg-n7x4q2" },
  { databaseName: "crmynov_prod", environment: "prod", project: "crmynov-prod-n7x4q2" },
];

/** Absence of the new contract preserves only the existing DEV launch. */
export function runtimeDatabaseTarget(input: RuntimeDatabaseTargetInput): RuntimeDatabaseTarget {
  const legacyDev = input.databaseName === undefined && input.databaseEnvironment === undefined && input.databaseProject === undefined;
  const target = targets.find((candidate) => legacyDev ? candidate.environment === "dev" :
    candidate.databaseName === input.databaseName && candidate.environment === input.databaseEnvironment && candidate.project === input.databaseProject);
  if (!target || input.observedProject !== undefined && input.observedProject !== target.project) throw new Error("crm_runtime_database_target_invalid");
  return { ...target };
}

export function assertRuntimeDatabaseIdentity(result: unknown, target: RuntimeDatabaseTarget): void {
  if (!Array.isArray(result) || result.length !== 1) throw new Error("crm_runtime_database_target_mismatch");
  const row: unknown = result[0];
  if (!row || typeof row !== "object" || !("databaseName" in row) || row.databaseName !== target.databaseName) throw new Error("crm_runtime_database_target_mismatch");
}
