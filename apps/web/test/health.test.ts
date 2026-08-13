import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/health/route";

test("frontend healthcheck returns a sanitized success payload", async () => {
  const response = GET();
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["service", "status", "timestamp"]);
  assert.equal(body.service, "frontend");
  assert.equal(body.status, "ok");
});
