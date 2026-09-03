import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { auditId, parseAuditQuery } from "../src/audit/audit-query.js";

const now = new Date("2026-09-03T12:00:00Z");
const id = "00000000-0000-4000-8000-000000000054";
function rejected(raw: Record<string, unknown>): void {
  assert.throws(() => parseAuditQuery(raw, now), (error: unknown) => {
    assert.ok(error instanceof BadRequestException);
    assert.equal(error.getStatus(), 400);
    assert.deepEqual(error.getResponse(), { code: "audit_query_invalid" });
    return true;
  });
}
test("CRMY-54 closed query keeps pagination defaults, limits and explicit snapshot", () => {
  const defaults = parseAuditQuery({}, now);
  assert.deepEqual(defaults, { page: 1, pageSize: 25, snapshot: now });
  assert.ok(parseAuditQuery({}).snapshot instanceof Date);
  assert.deepEqual(parseAuditQuery({ page: "10000", pageSize: "100", snapshot: now.toISOString() }, now), { page: 10000, pageSize: 100, snapshot: now });
  assert.equal(parseAuditQuery({ page: "000001", pageSize: "1" }, now).page, 1);
  for (const raw of [{ extra: "x" }, { page: "10001" }, { page: "0000000" }, { page: "0" }, { page: "-1" }, { page: 1 }, { pageSize: "101" }, { pageSize: "0" }, { pageSize: [] }, { snapshot: "2026-09-03T12:00:00.001Z" }]) rejected(raw);
});
test("CRMY-54 period filters preserve UTC and reject impossible or reversed dates", () => {
  const from = "2026-09-01T00:00:00Z", to = "2026-09-02T00:00:00.001Z";
  assert.deepEqual(parseAuditQuery({ from, to }, now), { page: 1, pageSize: 25, snapshot: now, from: new Date(from), to: new Date(to) });
  assert.equal(parseAuditQuery({ from }, now).to, undefined);
  assert.equal(parseAuditQuery({ to }, now).from, undefined);
  assert.equal(parseAuditQuery({ from, to: from }, now).from?.getTime(), new Date(from).getTime());
  for (const raw of [{ from: "2026-02-30T00:00:00Z" }, { to: "2026-13-01T00:00:00Z" }, { from: "2026-01-01T25:00:00Z" }, { from: [] }, { to: "not-a-date" }, { snapshot: "2026-09-03" }, { from: to, to: from }]) rejected(raw);
});
test("CRMY-54 exact identities and action filters cannot introduce arbitrary fields", () => {
  assert.equal(auditId(id.toUpperCase()), id.toUpperCase());
  for (const key of ["actorId", "resourceId", "campus"]) {
    assert.equal(Reflect.get(parseAuditQuery({ [key]: id }, now), key), id);
    rejected({ [key]: "synthetic@example.invalid" }); rejected({ [key]: [] });
  }
  for (const key of ["eventType", "resourceType"]) {
    assert.equal(Reflect.get(parseAuditQuery({ [key]: "LEAD_CREATED" }, now), key), "LEAD_CREATED");
    for (const value of ["", "lowercase", "A".repeat(81), "LEAD-CREATED", []]) rejected({ [key]: value });
  }
  for (const result of ["SUCCESS", "DENIED", "FAILED"]) assert.equal(parseAuditQuery({ result }, now).result, result);
  for (const result of ["OTHER", [], 1]) rejected({ result });
});
