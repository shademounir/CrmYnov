import { PrismaClient } from "@prisma/client";

interface RuntimeDatabaseClient {
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  $disconnect(): Promise<void>;
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
  try {
    // Cloud SQL built-in users can inherit administrative privileges by default.
    await prisma.$executeRaw`REVOKE cloudsqlsuperuser FROM "crm_runtime"`;
    await prisma.$executeRaw`ALTER ROLE "crm_runtime" NOCREATEDB NOCREATEROLE CONNECTION LIMIT 20`;
    await prisma.$executeRaw`REVOKE CREATE ON SCHEMA public FROM PUBLIC`;
    await prisma.$executeRaw`GRANT CONNECT ON DATABASE crmynov_dev TO "crm_runtime"`;
    await prisma.$executeRaw`GRANT USAGE ON SCHEMA public TO "crm_runtime"`;
    await prisma.$executeRaw`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "crm_runtime"`;
    await prisma.$executeRaw`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO "crm_runtime"`;
    await prisma.$executeRaw`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "crm_runtime"`;
    await prisma.$executeRaw`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "crm_runtime"`;
    await prisma.$executeRaw`REVOKE ALL ON TABLE public."_prisma_migrations" FROM "crm_runtime"`;
    dependencies.write(`${JSON.stringify({ job: "grant-runtime-database", completed: true, runtimeRole })}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

export function runtimeDatabaseGrantFailure(error: unknown): string {
  const code = error instanceof Error && ["crm_runtime_database_role_invalid", "crm_runtime_database_role_not_allowlisted"].includes(error.message)
    ? error.message : "crm_runtime_database_grant_failed";
  return `${JSON.stringify({ job: "grant-runtime-database", completed: false, code })}\n`;
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/jobs/grant-runtime-database.js")) {
  void runRuntimeDatabaseGrantJob().catch((error: unknown) => {
    process.stderr.write(runtimeDatabaseGrantFailure(error));
    process.exitCode = 1;
  });
}
