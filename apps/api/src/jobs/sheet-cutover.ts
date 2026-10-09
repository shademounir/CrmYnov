import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ConflictException } from "@nestjs/common";
import { AppModule } from "../app.module.js";
import { CutoverRuntimeService, cutoverRuntimeError, cutoverWorkerEnabled } from "../cutover/cutover-runtime.service.js";

export interface SheetCutoverJobDependencies {
  environment: Readonly<Record<string, string | undefined>>;
  createContext(): Promise<{ get(token: typeof CutoverRuntimeService): Pick<CutoverRuntimeService, "tick">; close(): Promise<void> }>;
  write(message: string): void;
}
export async function runSheetCutoverJob(dependencies: SheetCutoverJobDependencies = {
  environment: process.env, createContext: () => NestFactory.createApplicationContext(AppModule, { logger: ["error"] }), write: (message) => process.stdout.write(message),
}): Promise<void> {
  if (!cutoverWorkerEnabled(dependencies.environment)) { dependencies.write(`${JSON.stringify({ job: "sheet-cutover", skipped: "cutover_flags_off" })}\n`); return; }
  if (dependencies.environment.CRM_BACKGROUND_WORKERS !== "external") throw new Error("cutover_external_worker_required");
  const context = await dependencies.createContext();
  try {
    const result = await context.get(CutoverRuntimeService).tick();
    const runs = result && typeof result === "object" && "runs" in result && Array.isArray(result.runs) ? result.runs : [];
    const incomplete = runs.some((run: unknown) => run && typeof run === "object" && "status" in run && (run.status === "FAILED" || run.status === "BLOCKED"));
    dependencies.write(`${JSON.stringify({ job: "sheet-cutover", completed: !incomplete, result })}\n`);
    if (incomplete) throw new ConflictException({ code: "cutover_runs_incomplete" });
  }
  finally { await context.close(); }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/jobs/sheet-cutover.js")) {
  void runSheetCutoverJob().catch((error: unknown) => { process.stderr.write(`${JSON.stringify({ job: "sheet-cutover", completed: false, code: cutoverRuntimeError(error) })}\n`); process.exitCode = 1; });
}
