import { execFileSync } from "node:child_process";

// The existing proof owns its disposable, loopback-only PostgreSQL container.
// Never let it inherit a recipe, DEV or production database URL or live workers.
if (process.env.DATABASE_URL !== undefined) throw new Error("follow_up_due_must_not_inherit_database");
const env = { ...process.env, CRMY_FOLLOW_UP_POSTGRES: "true", CRM_BACKGROUND_WORKERS: "external", SHEETS_ENABLED: "false" };
execFileSync(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=1", "test/follow-up-postgres.test.ts"], {
  cwd: "apps/api", env, stdio: "inherit", windowsHide: true, timeout: 300_000,
});
