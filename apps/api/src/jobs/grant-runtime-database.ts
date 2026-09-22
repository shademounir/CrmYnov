import { PrismaClient } from "@prisma/client";

const runtimeRole = process.env.CRM_RUNTIME_DATABASE_ROLE?.trim();

async function run(): Promise<void> {
  if (!runtimeRole || !/^[a-z][a-z0-9_]{2,62}$/.test(runtimeRole)) {
    throw new Error("crm_runtime_database_role_invalid");
  }

  const prisma = new PrismaClient();
  try {
    if (runtimeRole !== "crm_runtime") throw new Error("crm_runtime_database_role_not_allowlisted");
    await prisma.$executeRaw`GRANT CONNECT ON DATABASE crmynov_dev TO "crm_runtime"`;
    await prisma.$executeRaw`GRANT USAGE ON SCHEMA public TO "crm_runtime"`;
    await prisma.$executeRaw`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "crm_runtime"`;
    await prisma.$executeRaw`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO "crm_runtime"`;
    await prisma.$executeRaw`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "crm_runtime"`;
    await prisma.$executeRaw`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "crm_runtime"`;
    process.stdout.write(`${JSON.stringify({ job: "grant-runtime-database", completed: true, runtimeRole })}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void run().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ job: "grant-runtime-database", completed: false, code: error instanceof Error ? error.message : "unknown_error" })}\n`);
  process.exitCode = 1;
});
