import assert from "node:assert/strict";
import test from "node:test";
import { AuditService } from "../src/audit/audit.service.js";
import type { Principal } from "../src/auth/auth.types.js";
import { SavedLeadViewService } from "../src/leads/saved-lead-view.service.js";

const owner: Principal = { userId: "owner", roles: ["ADMISSIONS"], scopes: [{ kind: "CAMPUS", id: "Campus A" }], sessionId: "synthetic" };
const other: Principal = { ...owner, userId: "other" };
const globalManager: Principal = { userId: "manager", roles: ["MANAGER"], scopes: [{ kind: "GLOBAL" }], sessionId: "synthetic-manager" };
const code = (expected: string) => (error: unknown): boolean => JSON.stringify((error as { getResponse?: () => unknown }).getResponse?.() ?? error).includes(expected);
function service(): { views: SavedLeadViewService; audit: AuditService } { const audit = new AuditService(); return { views: new SavedLeadViewService(audit), audit }; }

test("creates, loads, updates and deletes a private normalized lead view with an append-only audit", async () => {
  const { views, audit } = service(); const created = await views.create({ name: "  Mes prospects  ", filters: { status: "PROSPECT", campus: "Campus A", search: "Alex" } }, owner, "create");
  assert.equal(created.name, "Mes prospects"); assert.deepEqual(created.filters, { status: "PROSPECT", campus: "Campus A", search: "Alex" }); assert.equal((await views.list(owner))[0]?.id, created.id);
  const updated = await views.update(created.id, { name: "Mes prospects prioritaires", filters: { status: "CONTACTED" }, expectedVersion: 1 }, owner, "update"); assert.equal(updated.version, 2); assert.deepEqual(updated.filters, { status: "CONTACTED" });
  await views.remove(created.id, owner, "delete"); assert.equal((await views.list(owner)).length, 0); assert.equal(audit.list().filter((event) => event.eventType.startsWith("SAVED_LEAD_VIEW_")).length, 3);
});

test("fails closed for malformed filters, unknown keys, scope escapes and mass assignment", async () => {
  const { views } = service();
  await assert.rejects(() => views.create({ name: "Valid", filters: { unknown: "x" } }, owner, "unknown"), code("saved_view_filter_forbidden"));
  await assert.rejects(() => views.create({ name: "Valid", filters: { campus: "Campus B" } }, owner, "campus"), code("saved_view_campus_forbidden"));
  await assert.rejects(() => views.create({ name: "<invalid>", filters: {} }, owner, "name"), code("saved_view_name_invalid"));
  await assert.rejects(() => views.create({ name: "Valid", filters: { status: { injected: true } } }, owner, "mass"), code("saved_view_filter_forbidden"));
});

test("prevents cross-user reads, updates and deletes and validates optimistic versions", async () => {
  const { views } = service(); const created = await views.create({ name: "Privée", filters: { status: "PROSPECT" } }, owner, "create");
  assert.equal((await views.list(other)).length, 0);
  await assert.rejects(() => views.update(created.id, { name: "Vol", filters: {} }, other, "idor-update"), code("saved_view_owner_forbidden"));
  await assert.rejects(() => views.remove(created.id, other, "idor-delete"), code("saved_view_owner_forbidden"));
  await assert.rejects(() => views.update(created.id, { name: "Conflit", filters: {}, expectedVersion: 2 }, owner, "conflict"), code("saved_view_version_conflict"));
  assert.equal((await views.create({ name: "Global", filters: { campus: "Campus B" } }, globalManager, "global")).filters.campus, "Campus B");
});
