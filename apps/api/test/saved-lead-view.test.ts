import assert from "node:assert/strict";
import test from "node:test";
import { AuditService } from "../src/audit/audit.service.js";
import type { Principal } from "../src/auth/auth.types.js";
import { SavedLeadViewService } from "../src/leads/saved-lead-view.service.js";
import { SavedLeadViewController } from "../src/leads/saved-lead-view.controller.js";

const owner: Principal = { userId: "owner", roles: ["ADMISSIONS"], scopes: [{ kind: "CAMPUS", id: "Campus A" }], sessionId: "synthetic" };
const other: Principal = { ...owner, userId: "other" };
const globalManager: Principal = { userId: "manager", roles: ["MANAGER"], scopes: [{ kind: "GLOBAL" }], sessionId: "synthetic-manager" };
const code = (expected: string) => (error: unknown): boolean => JSON.stringify((error as { getResponse?: () => unknown }).getResponse?.() ?? error).includes(expected);
function service(): { views: SavedLeadViewService; audit: AuditService } { const audit = new AuditService(); return { views: new SavedLeadViewService(audit), audit }; }
function persistentService(): SavedLeadViewService {
  type Row = { id: string; ownerId: string; name: string; filters: Record<string, string>; version: number; createdAt: Date; updatedAt: Date };
  const rows = new Map<string, Row>();
  const store = {
    findMany: ({ where }: { where: { ownerId: string } }): Promise<Row[]> => Promise.resolve([...rows.values()].filter((row) => row.ownerId === where.ownerId)),
    findUnique: ({ where }: { where: { id: string } }): Promise<Row | null> => Promise.resolve(rows.get(where.id) ?? null),
    create: ({ data }: { data: { ownerId: string; name: string; filters: Record<string, string> } }): Promise<Row> => { const now = new Date(); const row = { id: `view-${rows.size + 1}`, ...data, version: 1, createdAt: now, updatedAt: now }; rows.set(row.id, row); return Promise.resolve(row); },
    update: ({ where, data }: { where: { id: string }; data: { name: string; filters: Record<string, string>; version: { increment: number } } }): Promise<Row> => { const current = rows.get(where.id)!; const row = { ...current, name: data.name, filters: data.filters, version: current.version + data.version.increment, updatedAt: new Date() }; rows.set(row.id, row); return Promise.resolve(row); },
    delete: ({ where }: { where: { id: string } }): Promise<Row> => { const current = rows.get(where.id)!; rows.delete(where.id); return Promise.resolve(current); },
  };
  const client = { savedLeadView: store, $transaction: async <T>(callback: (tx: { savedLeadView: typeof store }) => Promise<T>): Promise<T> => callback({ savedLeadView: store }) };
  return new SavedLeadViewService(new AuditService(), { client } as never);
}

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

test("uses the Prisma transaction adapter for persistent private views", async () => {
  const views = persistentService(); const created = await views.create({ name: "Persistée", filters: { program: "Programme" } }, owner, "persistent-create");
  assert.equal((await views.list(owner)).length, 1); assert.equal((await views.update(created.id, { name: "Persistée 2", filters: { source: "WEB" }, expectedVersion: 1 }, owner, "persistent-update")).version, 2);
  await views.remove(created.id, owner, "persistent-delete"); await assert.rejects(() => views.remove(created.id, owner, "missing"), code("saved_view_not_found"));
});

test("controller forwards only authenticated principals and correlation metadata", async () => {
  const { views } = service(); const controller = new SavedLeadViewController(views); const request = { principal: owner, header: () => "saved-view-controller" } as never;
  const created = await controller.create({ name: "Contrôleur", filters: { status: "PROSPECT" } }, request);
  assert.equal((await controller.list(request)).at(0)?.id, created.id); await controller.update(created.id, { name: "Contrôleur 2", filters: {} }, request); await controller.remove(created.id, request);
  await assert.rejects(() => controller.list({ header: () => undefined } as never), /principal_missing/);
});
