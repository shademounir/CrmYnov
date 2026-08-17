import assert from "node:assert/strict";
import test from "node:test";
import AuditPage from "../app/audit/page";

test("renders the protected audit trail shell without real data", () => {
  const page = AuditPage();
  assert.equal(page.type, "main");
  assert.match(JSON.stringify(page.props), /Piste d.audit/);
  assert.doesNotMatch(JSON.stringify(page.props), /never-log|real-user|candidate/i);
});
