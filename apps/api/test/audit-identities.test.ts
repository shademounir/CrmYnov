import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { AuditEvent, PrismaClient } from "@prisma/client";
import type { Principal } from "../src/auth/auth.types.js";
import type { ResourceContext } from "../src/permissions/permission.service.js";
import { auditIdentities } from "../src/audit/audit-identities.js";

const campusId = randomUUID(), foreignCampus = randomUUID(), actorId = randomUUID(), leadId = randomUUID(), appointmentId = randomUUID();
const principal: Principal = { userId: randomUUID(), sessionId: randomUUID(), roles: ["AUDITOR"], scopes: [{ kind: "CAMPUS", id: campusId }] };
function event(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return { id: randomUUID(), campusId, resourceType: "LEAD", resourceId: leadId, eventType: "LEAD_UPDATED", actorId, actorRoles: ["MANAGER"], minimizedIp: null, sessionId: null, correlationId: randomUUID(), before: null, after: null, result: "SUCCESS", idempotencyKey: randomUUID(), occurredAt: new Date("2026-10-20T22:00:00Z"), ...overrides };
}
interface IdentityFixture {
  client: PrismaClient;
  permissions: { can(who: Principal | undefined, key: string, resource: ResourceContext): Promise<boolean> };
  actor: { id: string; professionalDisplayName: string; campusId: string | null; active: boolean };
  lead: { id: string; firstName: string; lastName: string; leadCode: string; campus: string; assignedToId: string; collaborators: Array<{ userId: string }> };
  calls: Array<[string, unknown]>;
  denyLead(): void;
}
function fixture(): IdentityFixture {
  const calls: Array<[string, unknown]> = [];
  const actor: IdentityFixture["actor"] = { id: actorId, professionalDisplayName: "Conseiller Synthétique", campusId, active: true };
  const lead = { id: leadId, firstName: "Dossier", lastName: "Synthétique", leadCode: "LD-SYNTHETIC", campus: campusId, assignedToId: actorId, collaborators: [{ userId: principal.userId }] };
  let allowLead = true;
  const client = {
    collaborator: { findMany: (query: unknown) => { calls.push(["actors", query]); return Promise.resolve([actor]); } },
    appointment: { findMany: (query: unknown) => { calls.push(["appointments", query]); return Promise.resolve([{ id: appointmentId, leadId }]); } },
    lead: { findMany: (query: unknown) => { calls.push(["leads", query]); return Promise.resolve([lead]); } },
    crmReference: { findUnique: ({ where }: { where: { id: string } }) => Promise.resolve({ id: where.id, kind: "CAMPUS", state: "ACTIVE", code: where.id, label: where.id }) },
    crmReferenceKey: { findMany: () => Promise.resolve([]) },
  } as unknown as PrismaClient;
  const permissions = { can: (_who: Principal | undefined, key: string, resource: ResourceContext): Promise<boolean> => {
    calls.push([key, resource]);
    return Promise.resolve(Boolean(resource.campusKeys?.includes(campusId)) && (key !== "lead.view" || allowLead));
  } };
  return { client, permissions, actor, lead, calls, denyLead: (): void => { allowLead = false; } };
}
test("audit identities enrich only bounded event relations with minimal projections, never rewrite history", async () => {
  const f = fixture(), rows = [event(), event({ resourceType: "APPOINTMENT", resourceId: appointmentId })], before = JSON.stringify(rows);
  const views = await auditIdentities(f.client, f.permissions, principal, rows);
  for (const view of views) {
    assert.deepEqual(view.actorDisplay, { kind: "CURRENT_PROFILE", label: "Conseiller Synthétique" });
    assert.deepEqual(view.leadDisplay, { kind: "CURRENT_RECORD", id: leadId, label: "Dossier Synthétique", reference: "LD-SYNTHETIC" });
  }
  assert.equal(JSON.stringify(rows), before);
  assert.deepEqual(f.calls.find(([kind]) => kind === "actors")?.[1], { where: { id: { in: [actorId] } }, select: { id: true, professionalDisplayName: true, campusId: true, active: true } });
  assert.deepEqual(f.calls.find(([kind]) => kind === "appointments")?.[1], { where: { id: { in: [appointmentId] } }, select: { id: true, leadId: true } });
  assert.deepEqual(f.calls.find(([kind]) => kind === "leads")?.[1], { where: { id: { in: [leadId] } }, select: { id: true, firstName: true, lastName: true, leadCode: true, campus: true, assignedToId: true, collaborators: { where: { active: true }, select: { userId: true } } } });
  assert.ok(f.calls.some(([kind, resource]) => kind === "lead.view" && (resource as ResourceContext).ownerId === actorId && (resource as ResourceContext).collaboratorIds?.includes(principal.userId)));
  assert.doesNotMatch(JSON.stringify(views), /professionalEmail|sessionId|correlationId/);
});
test("audit identities never expose current Lead identity after effective lead access is revoked", async () => {
  const f = fixture(); f.denyLead();
  const [view] = await auditIdentities(f.client, f.permissions, principal, [event()]);
  assert.deepEqual(view!.leadDisplay, { kind: "UNAVAILABLE", id: null, label: null, reference: null });
  assert.doesNotMatch(JSON.stringify(view), /Dossier Synthétique|LD-SYNTHETIC/);
});
test("audit invalid blank or unknown campus never falls back to GLOBAL even for a global reader", async () => {
  for (const invalid of ["", "   ", "SYNTHETIC-UNKNOWN-CAMPUS"]) {
    const f = fixture(); f.actor.campusId = invalid; f.lead.campus = invalid;
    const scopes: string[] = [];
    const permissions = { can: (_who: Principal | undefined, _key: string, resource: ResourceContext): Promise<boolean> => { scopes.push(resource.scope); return Promise.resolve(true); } };
    const [view] = await auditIdentities(f.client, permissions, principal, [event()]);
    assert.equal(view!.actorDisplay.kind, "UNAVAILABLE"); assert.equal(view!.leadDisplay.kind, "UNAVAILABLE");
    assert.deepEqual(scopes, [], "invalid campus is rejected before any GLOBAL permission lookup");
  }
});
test("audit legitimately null actor campus still requires GLOBAL audit permission", async () => {
  const f = fixture(); f.actor.campusId = null;
  const permissions = { can: (_who: Principal | undefined, key: string, resource: ResourceContext): Promise<boolean> => Promise.resolve(key === "audit.view" && resource.scope === "GLOBAL") };
  const [view] = await auditIdentities(f.client, permissions, principal, [event()]);
  assert.equal(view!.actorDisplay.kind, "CURRENT_PROFILE"); assert.equal(view!.leadDisplay.kind, "UNAVAILABLE");
  const [denied] = await auditIdentities(f.client, f.permissions, principal, [event()]);
  assert.equal(denied!.actorDisplay.kind, "UNAVAILABLE");
});
test("audit identities mask foreign current campus, inactive and invalid profiles without email fallback", async () => {
  for (const change of [{ campusId: foreignCampus }, { active: false }, { professionalDisplayName: "" }, { professionalDisplayName: "bad\nname" }]) {
    const f = fixture(); Object.assign(f.actor, change); f.lead.campus = foreignCampus;
    const [view] = await auditIdentities(f.client, f.permissions, principal, [event()]);
    assert.deepEqual(view!.actorDisplay, { kind: "UNAVAILABLE", label: null });
    assert.equal(view!.leadDisplay.kind, "UNAVAILABLE");
    assert.doesNotMatch(JSON.stringify(view), /Conseiller Synthétique|Dossier Synthétique/);
  }
});
test("audit identities distinguish system actor from task owner and ignore arbitrary JSON relations", async () => {
  const f = fixture();
  const [view] = await auditIdentities(f.client, f.permissions, principal, [event({ actorRoles: ["SYSTEM"], resourceType: "SETTING", resourceId: randomUUID(), after: { leadId, actorName: "Untrusted" } })]);
  assert.deepEqual(view!.actorDisplay, { kind: "SYSTEM", label: null });
  assert.equal(view!.leadDisplay.kind, "NOT_APPLICABLE");
  assert.equal(f.calls.length, 0);
  assert.deepEqual(view!.after, {});
  await assert.rejects(auditIdentities(f.client, f.permissions, principal, Array.from({ length: 101 }, () => event())), /unbounded/);
});
