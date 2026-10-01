import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { ViewSummary, ShareSummary, Audience } from "../../src/leads/view-sharing.contract.js";
import { defaultConfiguration } from "../../src/permissions/dynamic-evaluator.js";

interface Actor { id: string; token: string }
export interface SharingFixture { campusA: string; campusB: string; responsibility: string; leadId: string; manager: Actor; adviser: Actor; auditor: Actor; admin: Actor; outsider: Actor; superAdmin: Actor }

/** Real HTTP only: principals are resolved from local sessions by the server interceptor. */
export async function assertSharingCycle(client: PrismaClient, bases: string[], f: SharingFixture, report: (message: string) => void): Promise<void> {
  async function request(actor: Actor, path: string, method = "GET", body?: unknown, trace = "sharing-synthetic", instance = 0): Promise<Response> {
    return fetch(`${bases[instance]}${path}`, { method, headers: { authorization: `Bearer ${actor.token}`, "content-type": "application/json", "x-correlation-id": trace }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function ok<T>(actor: Actor, path: string, method = "GET", body?: unknown, instance = 0): Promise<T> {
    const response = await request(actor, path, method, body, "sharing-synthetic", instance);
    assert.equal(response.status, method === "POST" ? 201 : 200, `${method} ${path} authenticated result`);
    return response.json() as Promise<T>;
  }
  function command(version: number): { expectedVersion: number; idempotencyKey: string } { return { expectedVersion: version, idempotencyKey: randomUUID() }; }
  async function view(actor: Actor, name: string): Promise<ViewSummary> { return ok(actor, "/lead-views", "POST", { name, filters: { status: "PROSPECT" } }); }
  async function history(actor: Actor): Promise<ShareSummary[]> { return ok(actor, "/view-sharing/history"); }
  async function refuse(actor: Actor, path: string, method: string, body?: unknown, expected = 403): Promise<void> {
    const before = await client.auditEvent.count(); const response = await request(actor, path, method, body);
    assert.equal(response.status, expected, `${method} ${path} refusal`); assert.equal(await client.auditEvent.count(), before, "no success audit for a refused mutation");
  }
  const audiences = await ok<Audience[]>(f.manager, "/view-sharing/audiences");
  assert.deepEqual(audiences.map((a) => [a.kind, a.id]), [["TEAM", f.responsibility]]);
  const privateView = await view(f.manager, "Équipe synthétique"), path = `/view-sharing/views/${privateView.id}`;
  const sharedInput = { ...command(1), kind: "TEAM", audienceId: f.responsibility };
  const shared = await ok<ViewSummary>(f.manager, `${path}/shares`, "POST", sharedInput);
  assert.equal(shared.version, 2);
  assert.deepEqual(await ok(f.manager, `${path}/shares`, "POST", sharedInput, 1), shared);
  assert.equal(await client.auditEvent.count({ where: { resourceId: privateView.id } }), 2, "one creation and one sharing audit after replay");
  await refuse(f.manager, `${path}/shares`, "POST", { ...command(2), kind: "CAMPUS", audienceId: f.campusA });
  const adviserView = await view(f.adviser, "Privée conseiller"), adviserPath = `/view-sharing/views/${adviserView.id}`;
  await refuse(f.adviser, `${adviserPath}/shares`, "POST", { ...command(1), kind: "TEAM", audienceId: f.responsibility });
  await refuse(f.auditor, `${path}/shares`, "POST", { ...command(2), kind: "CAMPUS", audienceId: f.campusA });
  await refuse(f.outsider, path, "GET", undefined, 404);
  await refuse(f.outsider, `/view-sharing/views/${randomUUID()}`, "GET", undefined, 404);
  const read = await ok<ViewSummary>(f.adviser, path, "GET", undefined, 1);
  assert.equal(read.owned, false); assert.equal(read.version, 2);
  await refuse(f.adviser, `/lead-views/${privateView.id}`, "PATCH", { name: "Interdit", filters: {}, expectedVersion: 2 });
  await refuse(f.admin, `/lead-views/${privateView.id}`, "PATCH", { name: "Interdit", filters: {}, expectedVersion: 2 });
  report("TEAM governance, default denied sharing, owner-only editing, cross-campus non-disclosure and two-instance idempotence passed.");

  // Reader lead rights remain their own, even when the view is shared by a Manager.
  const target = { kind: "ROLE" as const, role: "ADMISSIONS" as const, campus: "GLOBAL" };
  const grants = { ...defaultConfiguration(target), "lead.view": "OWN", "lead.views.share.team": "TEAM" };
  await client.rolePermissionConfiguration.create({
    data: {
      ...target, id: "ROLE:ADMISSIONS:GLOBAL", version: 1,
      versions: { create: { number: 1, grants: { create: Object.entries(grants).map(([permission, scope]) => ({ permission, scope })) } } },
    },
  });
  await client.lead.update({ where: { id: f.leadId }, data: { assignedToId: f.manager.id } });
  const hidden = await ok<{ items: { id: string }[]; total: number }>(f.adviser, `/leads?sharedViewId=${privateView.id}`);
  assert.equal(hidden.items.some((row) => row.id === f.leadId), false); assert.equal(hidden.total, 0);
  await client.lead.update({ where: { id: f.leadId }, data: { assignedToId: f.adviser.id } });
  const visible = await ok<{ items: { id: string }[] }>(f.adviser, `/leads?sharedViewId=${privateView.id}`);
  assert.equal(visible.items.some((row) => row.id === f.leadId), true);
  await ok(f.adviser, `${adviserPath}/shares`, "POST", { ...command(1), kind: "TEAM", audienceId: f.responsibility });
  const edited = await ok<ViewSummary>(f.manager, `/lead-views/${privateView.id}`, "PATCH", { name: "Équipe actualisée", filters: { status: "CONTACTED" }, expectedVersion: 2 });
  assert.equal(edited.version, 3); assert.equal((await ok<ViewSummary>(f.adviser, path)).filters.status, "CONTACTED");
  await refuse(f.manager, `/lead-views/${privateView.id}`, "PATCH", { name: "Ancienne version", filters: {}, expectedVersion: 2 }, 409);
  const copy = await ok<ViewSummary>(f.adviser, `${path}/duplicate`, "POST", { ...command(3), name: "Copie indépendante" });
  assert.equal(copy.owned, true); assert.notEqual(copy.id, privateView.id);
  assert.equal(await client.savedLeadViewShare.count({ where: { viewId: copy.id } }), 0);
  report("Reader OWN scope, controlled adviser grant, optimistic owner edit and independent private duplicate passed.");

  const record = (await history(f.manager)).find((row) => row.viewId === privateView.id);
  assert.ok(record); const revoke = command(3);
  await ok(f.manager, `/view-sharing/shares/${record.id}/revoke`, "POST", revoke);
  await ok(f.manager, `/view-sharing/shares/${record.id}/revoke`, "POST", revoke, 1);
  await refuse(f.adviser, path, "GET", undefined, 404);
  await refuse(f.adviser, `/leads?sharedViewId=${privateView.id}`, "GET", undefined, 404);
  assert.equal((await client.savedLeadView.findUniqueOrThrow({ where: { id: privateView.id } })).archivedAt, null);
  assert.equal((await client.savedLeadViewShare.findUniqueOrThrow({ where: { id: record.id } })).active, false);
  const adviserShare = (await history(f.manager)).find((row) => row.viewId === adviserView.id); assert.ok(adviserShare?.canRevoke);
  await ok(f.manager, `/view-sharing/shares/${adviserShare.id}/revoke`, "POST", command(2));
  report("Owner and responsible Manager revocation immediate on both APIs and on old execution links; original and sharing history preserved.");

  const campusView = await view(f.admin, "Campus synthétique"), campusPath = `/view-sharing/views/${campusView.id}`;
  const concurrent = await Promise.all([0, 1].map((instance) => request(f.admin, `${campusPath}/shares`, "POST", { ...command(1), kind: "CAMPUS", audienceId: f.campusA }, "sharing-concurrency", instance)));
  assert.deepEqual(concurrent.map((r) => r.status).sort((a, b) => a - b), [201, 409]);
  assert.equal(await client.savedLeadViewShare.count({ where: { viewId: campusView.id } }), 1);
  assert.equal(await client.auditEvent.count({ where: { resourceId: campusView.id } }), 2);
  assert.equal((await ok<ViewSummary>(f.auditor, campusPath)).owned, false);
  const campusShare = (await history(f.admin)).find((row) => row.viewId === campusView.id); assert.ok(campusShare);
  await refuse(f.auditor, `/view-sharing/shares/${campusShare.id}/revoke`, "POST", command(2));
  await refuse(f.outsider, `/view-sharing/shares/${campusShare.id}/revoke`, "POST", command(2), 404);
  await ok(f.superAdmin, `/view-sharing/shares/${campusShare.id}/revoke`, "POST", command(2));
  await ok(f.admin, `${campusPath}/shares`, "POST", { ...command(3), kind: "CAMPUS", audienceId: f.campusA });
  const archive = command(4); await ok(f.admin, `${campusPath}/archive`, "POST", archive);
  await ok(f.admin, `${campusPath}/archive`, "POST", archive);
  await refuse(f.auditor, campusPath, "GET", undefined, 404);
  assert.equal(await client.savedLeadViewShare.count({ where: { viewId: campusView.id } }), 1);
  report("Campus sharing, read-only AUDITOR, administrative revocation, concurrent version conflict and archive history passed.");

  const baseline = await client.savedLeadView.findUniqueOrThrow({ where: { id: privateView.id } });
  const audits = await client.auditEvent.count(), receipts = await client.savedViewMutation.count();
  await client.$executeRawUnsafe("CREATE FUNCTION crmy170_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.correlation_id = 'sharing-audit-failure' THEN RAISE EXCEPTION 'synthetic_audit_failure'; END IF; RETURN NEW; END $$");
  await client.$executeRawUnsafe("CREATE TRIGGER crmy170_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION crmy170_fail_audit()");
  try {
    const response = await request(f.manager, `${path}/shares`, "POST", { ...command(baseline.version), kind: "TEAM", audienceId: f.responsibility }, "sharing-audit-failure");
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { code: "permission_store_unavailable" });
    assert.deepEqual(await client.savedLeadView.findUniqueOrThrow({ where: { id: privateView.id } }), baseline);
    assert.equal((await client.savedLeadViewShare.findUniqueOrThrow({ where: { id: record.id } })).active, false);
    assert.equal(await client.auditEvent.count(), audits); assert.equal(await client.savedViewMutation.count(), receipts);
  } finally {
    await client.$executeRawUnsafe("DROP TRIGGER crmy170_audit_failure ON audit_events");
    await client.$executeRawUnsafe("DROP FUNCTION crmy170_fail_audit()");
  }
  for (const event of await client.auditEvent.findMany({ where: { resourceType: "SAVED_LEAD_VIEW" } })) {
    assert.equal(event.sessionId, null); assert.equal(event.result, "SUCCESS"); assert.ok(event.actorId);
    const metadata = JSON.stringify([event.before, event.after]);
    for (const secret of [f.manager.token, f.adviser.token, "password", "email", "filters", "Équipe", "token", "session"]) assert.equal(metadata.includes(secret), false);
  }
  report("Audit failure rolled back business/version/share/receipt; persistent audit metadata excludes credentials, filter contents and session IDs.");
}
