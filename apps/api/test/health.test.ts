import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../src/persistence/prisma.service.js";
import { HealthController } from "../src/health.controller.js";

test("API healthcheck exposes no configuration or secret", () => {
  const result = new HealthController().getHealth();
  assert.deepEqual(Object.keys(result).sort(), ["service", "status", "timestamp"]);
  assert.equal(result.service, "api");
  assert.equal(result.status, "ok");
});

test("API readiness verifies PostgreSQL without exposing its URL", async () => {
  const controller = new HealthController({ client: { systemProbe: { count: () => Promise.resolve(1) } } } as unknown as PrismaService);
  const result = await controller.getReadiness();
  assert.equal(result.service, "api");
  assert.equal(result.status, "ok");
  assert.equal(result.database, "ready");
  assert.equal(JSON.stringify(result).includes("postgresql://"), false);
  await assert.rejects(() => new HealthController().getReadiness(), (error: unknown) => {
    const candidate = error as { getResponse?: () => unknown };
    return JSON.stringify(candidate.getResponse?.()).includes("database_unavailable");
  });
});
