import assert from "node:assert/strict";
import test from "node:test";
import { AuditController } from "../src/audit/audit.controller.js";
import { AuditService, minimizeIp } from "../src/audit/audit.service.js";
import type { AuditInput } from "../src/audit/audit.types.js";

test("records immutable, sanitized and idempotent audit events", () => {
  const audit = new AuditService();
  const input: AuditInput = { eventType: "LOGIN", actorId: "synthetic-user", actorRoles: ["AUDITOR"], sessionId: "00000000-0000-4000-8000-000000000001", correlationId: "corr-1", after: { token: "never-log", link: "https://example.invalid/private", allowed: true }, result: "SUCCESS", idempotencyKey: "login:1", ip: "203.0.113.42" };
  const first = audit.record(input);
  const duplicate = audit.record(input);
  assert.equal(first.id, duplicate.id);
  assert.equal(first.minimizedIp, "203.0.113.0");
  assert.deepEqual(first.after, { allowed: true });
  assert.equal(audit.list().length, 1);
});

test("bounds listing and exposes no mutation operation", () => {
  const audit = new AuditService();
  const controller = new AuditController(audit);
  assert.deepEqual(controller.list("9999"), { events: [] });
  assert.equal("update" in controller, false);
  assert.equal("delete" in controller, false);
  assert.equal(minimizeIp("2001:db8:1234:5678:90ab:cdef:1:2"), "2001:db8:1234:5678::");
});
