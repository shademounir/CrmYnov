import "reflect-metadata";
import { FollowUpPersistenceRepository } from "../../src/follow-up/follow-up-persistence.repository.js";
import { PrismaService } from "../../src/persistence/prisma.service.js";

// Test-only child process: no application context, scheduler, HTTP server or
// graceful teardown. The parent kills this exact worker after its commit marker.
const database = new URL(process.env.DATABASE_URL ?? "");
if (!["127.0.0.1", "localhost"].includes(database.hostname) || database.pathname !== "/crm_follow_up") throw new Error("synthetic_due_database_required");
const repository = new FollowUpPersistenceRepository(new PrismaService());
async function scan(message: { now: string }): Promise<void> {
  try {
    const result = await repository.markDue(new Date(message.now));
    process.send?.({ committed: true, result });
  } catch {
    process.send?.({ committed: false });
  }
}
process.on("message", (message: { now: string }): void => { void scan(message); });
