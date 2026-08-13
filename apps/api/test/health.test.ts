import assert from "node:assert/strict";
import test from "node:test";
import { HealthController } from "../src/health.controller.js";

test("API healthcheck exposes no configuration or secret", () => {
  const result = new HealthController().getHealth();
  assert.deepEqual(Object.keys(result).sort(), ["service", "status", "timestamp"]);
  assert.equal(result.service, "api");
  assert.equal(result.status, "ok");
});
