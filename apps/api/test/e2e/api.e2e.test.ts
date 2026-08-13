import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createApplication } from "../../src/application.js";

test("serves health, correlation and OpenAPI endpoints", async (context) => {
  const app = await createApplication();
  await app.listen(0, "127.0.0.1");
  context.after(() => app.close());
  const address = app.getHttpServer().address() as AddressInfo | null;
  assert.ok(address);

  const health = await fetch(`http://127.0.0.1:${address.port}/health`, {
    headers: { "x-correlation-id": "e2e-123" },
  });
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("x-correlation-id"), "e2e-123");
  assert.equal((await health.json() as { status: string }).status, "ok");

  const specification = await fetch(`http://127.0.0.1:${address.port}/docs-json`);
  assert.equal(specification.status, 200);
  assert.equal((await specification.json() as { info: { title: string } }).info.title, "CRM Admissions API");
});
