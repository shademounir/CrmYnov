import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module.js";
import { FollowUpDueScheduler } from "../follow-up/follow-up-due.scheduler.js";

interface FollowUpJobContext {
  get(token: typeof FollowUpDueScheduler): Pick<FollowUpDueScheduler, "tick">;
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
  createContext: () => NestFactory.createApplicationContext(AppModule, { logger: ["error"] }),
  now: () => new Date(),
  write: (message) => process.stdout.write(message),
};

export async function runFollowUpDueJob(dependencies: FollowUpDueJobDependencies = defaults): Promise<void> {
  if (dependencies.workersMode !== "external") throw new Error("crm_background_workers_must_be_external");
  const context = await dependencies.createContext();
  try {
    const result = await context.get(FollowUpDueScheduler).tick(dependencies.now());
    dependencies.write(`${JSON.stringify({ job: "follow-up-due", completed: true, ...result })}\n`);
  } finally {
    await context.close();
  }
}

export function followUpDueFailure(error: unknown): string {
  return `${JSON.stringify({ job: "follow-up-due", completed: false, code: error instanceof Error ? error.message : "unknown_error" })}\n`;
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/jobs/follow-up-due.js")) {
  void runFollowUpDueJob().catch((error: unknown) => {
    process.stderr.write(followUpDueFailure(error));
    process.exitCode = 1;
  });
}
