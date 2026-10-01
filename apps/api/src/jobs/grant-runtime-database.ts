import { PrismaClient } from "@prisma/client";

interface RuntimeDatabaseClient {
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  $disconnect(): Promise<void>;
}

type RuntimeDatabaseGrantStage =
  | "revoke_cloudsql_admin"
  | "bound_runtime_role"
  | "revoke_public_schema_create"
  | "grant_database_connect"
  | "grant_schema_usage"
  | "grant_table_dml"
  | "grant_sequence_usage"
  | "grant_default_table_dml"
  | "grant_default_sequence_usage"
  | "revoke_migration_history"
  | "disconnect";

class RuntimeDatabaseGrantStepError extends Error {
  constructor(readonly stage: RuntimeDatabaseGrantStage, cause: unknown) {
    super("crm_runtime_database_grant_step_failed", { cause });
    this.name = "RuntimeDatabaseGrantStepError";
  }
}

export interface RuntimeDatabaseGrantDependencies {
  runtimeRole: string | undefined;
  createClient(): RuntimeDatabaseClient;
  write(message: string): void;
}

const defaults: RuntimeDatabaseGrantDependencies = {
  runtimeRole: process.env.CRM_RUNTIME_DATABASE_ROLE?.trim(),
  createClient: () => new PrismaClient() as unknown as RuntimeDatabaseClient,
  write: (message) => process.stdout.write(message),
};

export async function runRuntimeDatabaseGrantJob(
  dependencies: RuntimeDatabaseGrantDependencies = defaults,
): Promise<void> {
  const { runtimeRole } = dependencies;
  if (!runtimeRole || !/^[a-z][a-z0-9_]{2,62}$/.test(runtimeRole)) {
    throw new Error("crm_runtime_database_role_invalid");
  }
  if (runtimeRole !== "crm_runtime") throw new Error("crm_runtime_database_role_not_allowlisted");

  const prisma = dependencies.createClient();
  let operationFailed = false;
  const runStep = async (stage: RuntimeDatabaseGrantStage, operation: () => Promise<unknown>): Promise<void> => {
    try {
      await operation();
    } catch (error: unknown) {
      throw new RuntimeDatabaseGrantStepError(stage, error);
    }
  };
  let failure: Error | undefined;
  try {
    // Cloud SQL built-in users can inherit administrative privileges by default.
    await runStep("revoke_cloudsql_admin", () => prisma.$executeRaw`REVOKE cloudsqlsuperuser FROM "crm_runtime"`);
    await runStep("bound_runtime_role", () => prisma.$executeRaw`ALTER ROLE "crm_runtime" NOCREATEDB NOCREATEROLE CONNECTION LIMIT 20`);
    await runStep("revoke_public_schema_create", () => prisma.$executeRaw`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
    await runStep("grant_database_connect", () => prisma.$executeRaw`GRANT CONNECT ON DATABASE crmynov_dev TO "crm_runtime"`);
    await runStep("grant_schema_usage", () => prisma.$executeRaw`GRANT USAGE ON SCHEMA public TO "crm_runtime"`);
    await runStep("grant_table_dml", () => prisma.$executeRaw`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "crm_runtime"`);
    await runStep("grant_sequence_usage", () => prisma.$executeRaw`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO "crm_runtime"`);
    await runStep("grant_default_table_dml", () => prisma.$executeRaw`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "crm_runtime"`);
    await runStep("grant_default_sequence_usage", () => prisma.$executeRaw`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "crm_runtime"`);
    await runStep("revoke_migration_history", () => prisma.$executeRaw`REVOKE ALL ON TABLE public."_prisma_migrations" FROM "crm_runtime"`);
  } catch (error: unknown) {
    operationFailed = true;
    failure = error instanceof Error ? error : new Error("crm_runtime_database_grant_failed", { cause: error });
  }
  try {
    await prisma.$disconnect();
  } catch (error: unknown) {
    if (!operationFailed) failure = new RuntimeDatabaseGrantStepError("disconnect", error);
  }
  if (failure !== undefined) throw failure;
  dependencies.write(`${JSON.stringify({ job: "grant-runtime-database", completed: true, runtimeRole, ...cloudRunExecutionContext(process.env) })}\n`);
}

function cloudRunExecutionContext(environment: NodeJS.ProcessEnv): Record<string, string> {
  const context: Record<string, string> = {};
  const safeValues: Array<[string, string | undefined, RegExp]> = [
    ["execution", environment.CLOUD_RUN_EXECUTION, /^[a-z][a-z0-9-]{0,62}$/],
    ["taskIndex", environment.CLOUD_RUN_TASK_INDEX, /^\d{1,6}$/],
    ["taskAttempt", environment.CLOUD_RUN_TASK_ATTEMPT, /^\d{1,6}$/],
  ];
  for (const [key, value, pattern] of safeValues) if (value && pattern.test(value)) context[key] = value;
  return context;
}

function prismaFailureCode(error: unknown): string {
  const candidate = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
  if (typeof candidate === "string" && /^P\d{4}$/.test(candidate)) return candidate;
  const name = error instanceof Error ? error.name : undefined;
  if (name === "PrismaClientInitializationError") return "prisma_client_initialization_error";
  if (name === "PrismaClientRustPanicError") return "prisma_client_engine_error";
  return "crm_runtime_database_grant_failed";
}

export function runtimeDatabaseGrantFailure(error: unknown, environment: NodeJS.ProcessEnv = process.env): string {
  const configurationCode = error instanceof Error && ["crm_runtime_database_role_invalid", "crm_runtime_database_role_not_allowlisted"].includes(error.message)
    ? error.message : undefined;
  const stepError = error instanceof RuntimeDatabaseGrantStepError ? error : undefined;
  const code = configurationCode ?? prismaFailureCode(stepError?.cause ?? error);
  return `${JSON.stringify({
    job: "grant-runtime-database",
    completed: false,
    code,
    ...(stepError ? { stage: stepError.stage } : {}),
    ...cloudRunExecutionContext(environment),
  })}\n`;
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/jobs/grant-runtime-database.js")) {
  void runRuntimeDatabaseGrantJob().catch((error: unknown) => {
    process.stderr.write(runtimeDatabaseGrantFailure(error));
    process.exitCode = 1;
  });
}
