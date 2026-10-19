import assert from "node:assert/strict";
import test from "node:test";
import { casablancaNextActionIso } from "../app/leads/next-action-time";

test("next action uses Casablanca civil time, not the workstation timezone", () => {
  assert.equal(casablancaNextActionIso("2026-10-20T10:30"), "2026-10-20T10:30:00.000Z");
  assert.equal(casablancaNextActionIso("2026-09-10T10:30"), "2026-09-10T09:30:00.000Z");
  assert.equal(casablancaNextActionIso("2026-03-01T10:30"), "2026-03-01T10:30:00.000Z");
  assert.equal(casablancaNextActionIso("2026-10-20T10:30:00+01:00"), "2026-10-20T09:30:00.000Z");
});

test("invalid dates and non-civil inputs are never silently normalized", () => {
  for (const value of ["2026-02-30T10:30", "2026-10-20T25:30", "not-a-date"]) assert.equal(casablancaNextActionIso(value), value);
  assert.equal(casablancaNextActionIso(""), "");
});
