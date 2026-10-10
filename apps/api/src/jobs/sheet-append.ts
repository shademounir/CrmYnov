import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module.js";
import { SheetImportExecutor } from "../sheet-import/sheet-import-executor.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { appendWorkerEnabled } from "../sheet-import/sheet-append-ledger.js";

/** OFF returns before creating an application context, opening SQL or Google I/O.
 * The executor independently rechecks policy, baseline reconciliation and grants. */
export async function runSheetAppendJob(): Promise<void> {
  if (!appendWorkerEnabled(process.env)) { process.stdout.write(`${JSON.stringify({ job: "sheet-append", skipped: "append_flags_off" })}\n`); return; }
  if (process.env.CRM_BACKGROUND_WORKERS !== "external") throw new Error("sheet_append_external_worker_required");
  if (process.env.CRM_SHEET_APPEND_POLICY_QUALIFIED !== "true") throw new Error("sheet_append_policy_not_qualified");
  const context = await NestFactory.createApplicationContext(AppModule, { logger: ["error"] });
  try {
    const client = context.get(PrismaService).client; if (!client) throw new Error("sheet_append_database_unavailable");
    const due = await client.$queryRaw<Array<{ id: string }>>`SELECT id FROM sheet_import_connectors
      WHERE configuration#>>'{source,identityMode}'='LOCAL_ROW_APPEND_ONLY' AND (enabled OR manual_requested OR active_run_id IS NOT NULL)
      AND next_run_at<=CURRENT_TIMESTAMP ORDER BY next_run_at,id LIMIT 20`;
    let failed = 0;
    for (const connector of due) {
      try {
        await context.get(SheetImportExecutor).execute(connector.id, "SCHEDULED");
        const run = await client.sheetImportRun.findFirst({ where: { connectorId: connector.id }, orderBy: [{ startedAt: "desc" }, { id: "desc" }] });
        if (run?.status === "FAILED") failed++;
      } catch { failed++; }
    }
    process.stdout.write(`${JSON.stringify({ job: "sheet-append", completed: failed === 0, inspected: due.length, failed })}\n`);
    if (failed) throw new Error("sheet_append_runs_failed");
  }
  finally { await context.close(); }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/jobs/sheet-append.js")) {
  void runSheetAppendJob().catch(() => { process.stderr.write(`${JSON.stringify({ job: "sheet-append", completed: false, code: "sheet_append_job_failed" })}\n`); process.exitCode = 1; });
}
