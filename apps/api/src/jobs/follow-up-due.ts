import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module.js";
import { FollowUpDueScheduler } from "../follow-up/follow-up-due.scheduler.js";

async function run(): Promise<void> {
  if (process.env.CRM_BACKGROUND_WORKERS !== "external") throw new Error("crm_background_workers_must_be_external");
  const context = await NestFactory.createApplicationContext(AppModule, { logger: ["error"] });
  try {
    const result = await context.get(FollowUpDueScheduler).tick(new Date());
    process.stdout.write(`${JSON.stringify({ job: "follow-up-due", completed: true, ...result })}\n`);
  } finally {
    await context.close();
  }
}

void run().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ job: "follow-up-due", completed: false, code: error instanceof Error ? error.message : "unknown_error" })}\n`);
  process.exitCode = 1;
});
