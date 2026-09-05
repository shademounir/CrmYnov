import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { ViewDetails, ViewSummary, ShareSummary } from "../../src/leads/view-sharing.contract.js";
import type { SharingFixture } from "./view-sharing-cycle.test.js";

export async function assertViewMetadata(client: PrismaClient, bases: string[], f: SharingFixture, report: (message: string) => void): Promise<void> {
  type Actor = SharingFixture["admin"];
  async function request(actor: Actor, path: string, method = "GET", body?: object, instance = 0): Promise<Response> {
    return fetch(`${bases[instance]}${path}`, { method, headers: { authorization: `Bearer ${actor.token}`, "content-type": "application/json", "x-correlation-id": "synthetic-name-metadata" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  async function ok<T>(actor: Actor, path: string, method = "GET", body?: object, instance = 0): Promise<T> {
    const response = await request(actor, path, method, body, instance);
    assert.equal(response.status, method === "POST" ? 201 : 200, `metadata ${method} ${path}`);
    return response.json() as Promise<T>;
  }
  const name = "Responsable synthétique Métadonnées";
  const input = { professionalEmail: "metadata-name@example.invalid", professionalDisplayName: `  ${name}  `, roles: ["ADMIN"], campusId: "SYNTHETIC" };
  const created = await ok<{ id: string }>(f.superAdmin, "/users", "POST", input);
  assert.equal((await client.collaborator.findUniqueOrThrow({ where: { id: created.id } })).professionalDisplayName, name);
  assert.equal(JSON.stringify(created).includes(name), false, "user creation response must not expose the display name");
  for (const [index, value] of [undefined, null, "   "].entries()) {
    const user = await ok<{ id: string }>(f.superAdmin, "/users", "POST", { ...input, professionalEmail: `metadata-null-${index}@example.invalid`, professionalDisplayName: value });
    assert.equal((await client.collaborator.findUniqueOrThrow({ where: { id: user.id } })).professionalDisplayName, null);
  }
  const before = await client.collaborator.count();
  for (const value of ["X".repeat(121), "Synthetic\nname", 12]) {
    const response = await request(f.superAdmin, "/users", "POST", { ...input, professionalEmail: "metadata-invalid@example.invalid", professionalDisplayName: value });
    assert.equal(response.status, 403); assert.deepEqual(await response.json(), { code: "professional_display_name_invalid" });
  }
  assert.equal(await client.collaborator.count(), before);
  assert.equal((await request(f.manager, "/users", "POST", input)).status, 403, "existing administrative gate remains mandatory");
  report("Professional name: authenticated creation persists trimmed synthetic name, absent/NULL/empty stay NULL, invalid writes leave no row; no user-response disclosure.");

  const view = await ok<ViewSummary>(f.admin, "/lead-views", "POST", { name: "Métadonnées synthétiques", filters: { status: "PROSPECT" } });
  const path = `/view-sharing/views/${view.id}`;
  const initial = await ok<ViewDetails>(f.admin, path);
  assert.equal(initial.ownerDisplayName, "Utilisateur indisponible"); assert.equal(initial.isOwner, true); assert.equal(initial.canEdit, true);
  // Explicit synthetic fixture values, never inferred from an email or copied from real users.
  await client.collaborator.update({ where: { id: f.admin.id }, data: { professionalDisplayName: name } });
  await ok(f.admin, `${path}/shares`, "POST", { expectedVersion: 1, idempotencyKey: randomUUID(), kind: "CAMPUS", audienceId: f.campusA });
  await ok(f.admin, `${path}/shares`, "POST", { expectedVersion: 2, idempotencyKey: randomUUID(), kind: "TEAM", audienceId: f.responsibility });
  const received = (await ok<ViewDetails[]>(f.adviser, "/view-sharing/received")).filter((row) => row.id === view.id);
  assert.equal(received.length, 1, "one view, aggregated audiences");
  const row = received[0]!;
  assert.equal(row.ownerDisplayName, name); assert.equal(row.isOwner, false);
  assert.deepEqual(row.visibleAudiences.map((a) => a.type).sort(), ["CAMPUS", "TEAM"]);
  assert.ok(row.visibleAudiences.every((a) => a.label.length > 0));
  assert.equal(row.canEdit, false); assert.equal(row.canRevoke, false); assert.equal(row.canDuplicate, true);
  const own = await ok<ViewDetails>(f.admin, path);
  assert.equal(own.isOwner, true); assert.equal(own.canEdit, true); assert.equal(own.canRevoke, true);
  const manager = await ok<ViewDetails>(f.manager, path);
  assert.equal(manager.canEdit, false); assert.equal(manager.canRevoke, true);
  const auditor = await ok<ViewDetails>(f.auditor, path);
  assert.deepEqual(auditor.visibleAudiences.map((a) => a.type), ["CAMPUS"], "non-member cannot learn the team audience");
  assert.equal(auditor.canEdit, false); assert.equal(auditor.canRevoke, false); assert.equal(auditor.canDuplicate, false);
  assert.deepEqual(Object.keys(row).sort(), ["id", "name", "version", "filters", "owned", "isOwner", "ownerDisplayName", "visibleAudiences", "canEdit", "canRevoke", "canDuplicate"].sort());
  for (const audience of row.visibleAudiences) assert.deepEqual(Object.keys(audience).sort(), ["label", "type"]);
  for (const forbidden of ["@", f.admin.id, f.adviser.token, "professionalEmail", "roles", "grants", "sessionId"]) assert.equal(JSON.stringify(row).includes(forbidden), false);
  assert.equal((await request(f.outsider, path)).status, 404);
  await client.collaborator.update({ where: { id: f.admin.id }, data: { active: false } });
  assert.equal((await ok<ViewDetails>(f.adviser, path, "GET", undefined, 1)).ownerDisplayName, "Utilisateur indisponible");
  await client.collaborator.update({ where: { id: f.admin.id }, data: { active: true } });
  const share = (await ok<ShareSummary[]>(f.admin, "/view-sharing/history")).find((a) => a.viewId === view.id && a.kind === "TEAM"); assert.ok(share);
  await ok(f.admin, `/view-sharing/shares/${share.id}/revoke`, "POST", { expectedVersion: 3, idempotencyKey: randomUUID() });
  assert.deepEqual((await ok<ViewDetails>(f.adviser, path, "GET", undefined, 1)).visibleAudiences.map((a) => a.type), ["CAMPUS"]);
  report("Metadata: synthetic owner, TEAM/CAMPUS aggregation, read-only recipients, owner edit, scoped revocation, AUDITOR non-mutation, disabled fallback and revoked audience hidden across instances.");

  await client.collaborator.update({ where: { id: f.superAdmin.id }, data: { professionalDisplayName: "Administrateur synthétique distant" } });
  const globalView = await ok<ViewSummary>(f.superAdmin, "/lead-views", "POST", { name: "Audiences synthétiques multiples", filters: {} });
  const globalPath = `/view-sharing/views/${globalView.id}`;
  for (const [i, campus] of [f.campusA, f.campusB].entries()) await ok(f.superAdmin, `${globalPath}/shares`, "POST", { expectedVersion: i + 1, idempotencyKey: randomUUID(), kind: "CAMPUS", audienceId: campus });
  assert.equal((await ok<ViewDetails>(f.superAdmin, globalPath)).visibleAudiences.length, 2);
  const campusOnly = await ok<ViewDetails>(f.admin, globalPath);
  assert.equal(campusOnly.visibleAudiences.length, 1); assert.equal(campusOnly.ownerDisplayName, "Utilisateur indisponible");
  assert.equal(JSON.stringify(campusOnly).includes("Administrateur synthétique distant"), false);
  assert.equal(campusOnly.canEdit, false, "administrative revocation never confers ownership");
  for (const event of await client.auditEvent.findMany({ where: { resourceType: "SAVED_LEAD_VIEW" } })) {
    const metadata = JSON.stringify([event.before, event.after]);
    for (const excluded of [name, "Administrateur synthétique distant", "professionalDisplayName", "professionalEmail", f.superAdmin.token]) assert.equal(metadata.includes(excluded), false);
  }
  report("Owner from another campus is neutralized; Admin sees one authorized audience, Super Admin sees both; metadata absent from append-only audit contents.");
}
