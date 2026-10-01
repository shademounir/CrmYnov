import assert from "node:assert/strict";
import test from "node:test";
import { auditDate, auditError, auditQuery, auditRequest } from "../app/admin/audit/audit-client.js";
test("CRMY-54 browser filters use exact identifiers, explicit UTC and no mutation", async () => {
  const form = new FormData(); form.set("actorId", " synthetic "); form.set("from", "2026-09-03T10:30"); form.set("campus", "synthetic-campus"); form.set("result", "SUCCESS");
  const query = new URLSearchParams(auditQuery(form)); assert.equal(query.get("actorId"), "synthetic"); assert.equal(query.get("from"), "2026-09-03T10:30:00.000Z"); assert.equal(query.get("campus"), "synthetic-campus"); assert.equal(query.get("result"), "SUCCESS");
  assert.equal(auditQuery(new FormData()), ""); assert.match(auditDate("2026-09-03T10:30:00Z"), /11:30/);
  const payload = await auditRequest<{ total: number }>("?page=1", new AbortController().signal, (input, init) => {
    assert.equal(input, "/api/crm/audit-events?page=1"); assert.equal(init?.method, undefined); assert.equal(init?.cache, "no-store"); assert.equal(init?.credentials, "same-origin"); return Promise.resolve(Response.json({ total: 1 }));
  }); assert.equal(payload.total, 1);
  for (const status of [400, 401, 403, 404, 503]) await assert.rejects(() => auditRequest("", new AbortController().signal, () => Promise.resolve(Response.json({}, { status }))), { message: auditError(status) });
});
