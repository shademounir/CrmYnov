import "reflect-metadata";
import { PrismaService } from "../persistence/prisma.service.js";
import { DynamicPermissionRepository } from "../permissions/dynamic-repository.js";
import { BusinessMailJournal } from "../business-mail/business-mail-journal.js";
import { BusinessMailRuntime } from "../business-mail/business-mail-runtime.js";
import { BusinessMailOperator, parseMailOperatorRequest } from "../business-mail/business-mail-operator.js";
import { assertRuntimeDatabaseIdentity, runtimeDatabaseTarget, type RuntimeDatabaseTarget } from "./runtime-database-target.js";
import { mailDiagnostic, mailStage, withMailCleanup } from "../permissions/safe-mail-diagnostic.js";

export function businessMailJobContract(env: NodeJS.ProcessEnv, mode: string): { skipped: true } | { skipped: false; target: RuntimeDatabaseTarget } {
  if (mode === "SEND" && env.CRM_BUSINESS_MAIL_ENABLED !== "true") return { skipped: true };
  if (!["SEND", "OPERATOR"].includes(mode) || env.CRM_BACKGROUND_WORKERS !== "external" || env.CRM_BUSINESS_MAIL_POLICY_QUALIFIED !== "true"
    || !env.CRM_RUNTIME_DATABASE_NAME || !env.CRM_RUNTIME_DATABASE_ENVIRONMENT || !env.CRM_RUNTIME_DATABASE_PROJECT
    || !env.GOOGLE_CLOUD_PROJECT || !/^[a-f0-9]{40}$/.test(env.CRM_BUSINESS_MAIL_SOURCE_SHA ?? "")) throw new Error("business_mail_job_contract_invalid");
  if (mode === "OPERATOR" && (env.CRM_BUSINESS_MAIL_OPERATOR_QUALIFIED !== "true" || env.CRM_BUSINESS_MAIL_DELEGATION !== "crm-ynov-po-delegation-20261001")) throw new Error("business_mail_operator_not_qualified");
  return { skipped: false, target: runtimeDatabaseTarget({ databaseName: env.CRM_RUNTIME_DATABASE_NAME, databaseEnvironment: env.CRM_RUNTIME_DATABASE_ENVIRONMENT,
    databaseProject: env.CRM_RUNTIME_DATABASE_PROJECT, observedProject: env.GOOGLE_CLOUD_PROJECT }) };
}

/** Separate entry point; never loaded by the API or old RC36 job. OFF stops
 * before SQL/OAuth. Failures are redacted and never cause a transport retry. */
export async function runBusinessMailJob(mode = "SEND"): Promise<void> {
  const contract = businessMailJobContract(process.env, mode);
  if (contract.skipped) { process.stdout.write(JSON.stringify({ job: "internal-business-mail", skipped: "flags_off" }) + "\n"); return; }
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  if (databaseUrl.protocol !== "postgresql:") throw new Error("business_mail_database_url_invalid");
  // The two dedicated clients must not exhaust the shared runtime role budget.
  // Only this new isolated process is affected; no URL/secret is ever logged.
  databaseUrl.searchParams.set("connection_limit", "2"); process.env.DATABASE_URL = databaseUrl.toString();
  const prisma = new PrismaService(), journal = new BusinessMailJournal();
  await withMailCleanup(async () => {
    const client = prisma.client; if (!client) throw new Error("business_mail_database_unavailable");
    await mailStage("DATABASE_IDENTITY", async () => assertRuntimeDatabaseIdentity(await client.$queryRaw`SELECT current_database() AS "databaseName"`, contract.target));
    const permissions = new DynamicPermissionRepository(prisma);
    if (mode === "OPERATOR") {
      const raw = process.env.CRM_BUSINESS_MAIL_OPERATION;
      if (!raw || Buffer.byteLength(raw, "utf8") > 16384) throw new Error("business_mail_operator_invalid");
      const request = parseMailOperatorRequest(JSON.parse(raw) as unknown);
      if (request.sourceSha !== process.env.CRM_BUSINESS_MAIL_SOURCE_SHA) throw new Error("business_mail_source_mismatch");
      const result = await mailStage("OPERATOR", () => new BusinessMailOperator(client, permissions, journal).execute(request));
      process.stdout.write(JSON.stringify({ job: "internal-business-mail-operator", completed: true, mode: request.mode, operationId: request.operationId, ...result }) + "\n");
    } else {
      const report = await mailStage("CONFIGURATION_READ", () => new BusinessMailRuntime(client, permissions, journal).run("SEND"));
      process.stdout.write(JSON.stringify({ job: "internal-business-mail", completed: true, sourceSha: process.env.CRM_BUSINESS_MAIL_SOURCE_SHA, ...report }) + "\n");
    }
  }, [(): Promise<void> => prisma.onModuleDestroy(), (): Promise<void> => journal.close()]);
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/jobs/business-mail.js")) {
  void runBusinessMailJob(process.argv[2] ?? "SEND").catch((error: unknown) => {
    process.stderr.write(JSON.stringify({ job: "internal-business-mail", completed: false, code: "business_mail_failed_reconcile_before_retry", ...mailDiagnostic(error) }) + "\n"); process.exitCode = 1;
  });
}
