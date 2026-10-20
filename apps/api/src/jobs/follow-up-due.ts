import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FollowUpPersistenceRepository } from "../follow-up/follow-up-persistence.repository.js";
import { FollowUpDueJobModule } from "./follow-up-due.module.js";

interface FollowUpJobContext {
  get(token: typeof FollowUpPersistenceRepository): Pick<FollowUpPersistenceRepository, "enabled" | "markDue">;
  close(): Promise<void>;
}

export interface FollowUpDueJobDependencies {
  workersMode: string | undefined;
  createContext(): Promise<FollowUpJobContext>;
  now(): Date;
  write(message: string): void;
}

const defaults: FollowUpDueJobDependencies = {
  workersMode: process.env.CRM_BACKGROUND_WORKERS,
  createContext: () => NestFactory.createApplicationContext(FollowUpDueJobModule, { logger: ["error"], abortOnError: false }),
  now: () => new Date(),
  write: (message) => process.stdout.write(message),
};

type JobStage = "create_context" | "mark_due" | "close_context";
class FollowUpDueJobFailure extends Error {
  constructor(readonly stage: JobStage, readonly original: unknown) { super("follow_up_due_job_failed"); }
}

export async function runFollowUpDueJob(dependencies: FollowUpDueJobDependencies = defaults): Promise<void> {
  if (dependencies.workersMode !== "external") throw new Error("crm_background_workers_must_be_external");
  let context: FollowUpJobContext | undefined;
  let result: { due: number; notifications: number } | undefined;
  let failure: FollowUpDueJobFailure | undefined;
  let stage: JobStage = "create_context";
  try {
    context = await dependencies.createContext();
    stage = "mark_due";
    const repository = context.get(FollowUpPersistenceRepository);
    if (!repository.enabled) throw new Error("follow_up_due_persistence_required");
    result = await repository.markDue(dependencies.now());
  } catch (error) {
    failure = new FollowUpDueJobFailure(stage, error);
  } finally {
    try { await context?.close(); }
    catch (error) { failure ??= new FollowUpDueJobFailure("close_context", error); }
  }
  if (failure) throw failure;
  dependencies.write(`${JSON.stringify({ job: "follow-up-due", completed: true, ...result })}\n`);
}

export function followUpDueFailure(error: unknown): string {
  const original = error instanceof FollowUpDueJobFailure ? error.original : error;
  const safeCodes = new Set(["crm_background_workers_must_be_external", "follow_up_due_persistence_required", "follow_up_due_audit_inconsistent", "follow_up_due_legacy_inconsistent", "permission_store_unavailable"]);
  let code = "follow_up_due_job_failed";
  if (original instanceof Error && safeCodes.has(original.message)) code = original.message;
  else if (original instanceof HttpException) {
    const response = original.getResponse();
    if (typeof response === "object" && response !== null && "code" in response && typeof response.code === "string" && safeCodes.has(response.code)) code = response.code;
  } else if (original && typeof original === "object" && "code" in original && typeof original.code === "string" && /^P\d{4}$/u.test(original.code)) code = original.code;
  return `${JSON.stringify({ job: "follow-up-due", completed: false, code, ...(error instanceof FollowUpDueJobFailure ? { stage: error.stage } : {}) })}\n`;
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/jobs/follow-up-due.js")) {
  void runFollowUpDueJob().catch((error: unknown) => {
    process.stderr.write(followUpDueFailure(error));
    process.exitCode = 1;
  });
}
