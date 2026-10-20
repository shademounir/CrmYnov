import assert from "node:assert/strict";
import test from "node:test";
import { AuditService } from "../src/audit/audit.service.js";
import { LeadService } from "../src/leads/lead.service.js";

const principal = { userId: "adviser-synthetic", roles: ["MANAGER" as const], scopes: [{ kind: "GLOBAL" as const }], sessionId: "00000000-0000-4000-8000-000000000001" };
const input = { firstName: "Recette", lastName: "Synthétique", campus: "CASABLANCA", campaign: "SYNTHETIC", educationLevel: "BAC", program: "SYNTHETIC", source: "WEB_FORM" };
test("new acquisitions use stable server CRM entry, not a client clock or baseline observation", (t) => {
  const service = new LeadService(new AuditService());
  for (const field of ["createdAt", "acquisitionKind"]) assert.throws(() => service.createLead({ ...input, [field]: "BASELINE" }, principal, "synthetic"), /Bad Request/);
  const before = Date.now();
  const created = service.createLead(input, principal, "synthetic").lead;
  assert.ok(Date.parse(created.createdAt) >= before && Date.parse(created.createdAt) <= Date.now());
  assert.equal(created.acquisitionKind, "NEW");
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-19T09:00:00.000Z") });
  service.registerLocalLead({ ...input, id: "old", leadCode: "LD-SYNTH-OLD", acquisitionKind: "NEW", assignedToId: principal.userId });
  t.mock.timers.setTime(Date.parse("2026-10-20T09:00:00.000Z"));
  service.registerLocalLead({ ...input, id: "new", leadCode: "LD-SYNTH-NEW", acquisitionKind: "NEW", assignedToId: principal.userId });
  t.mock.timers.setTime(Date.parse("2026-10-20T10:00:00.000Z"));
  service.registerLocalLead({ ...input, id: "baseline", leadCode: "LD-SYNTH-BASE", acquisitionKind: "BASELINE", assignedToId: principal.userId });
  const query = { page: 1, pageSize: 100, campus: "CASABLANCA", campaign: "SYNTHETIC", source: "WEB_FORM", status: "PROSPECT", assignedToId: principal.userId, createdFrom: "2026-10-19T00:00:00.000Z", createdBefore: "2026-10-21T00:00:00.000Z" };
  assert.deepEqual(service.listLeads({ ...query, view: "NEW_RECEIVED", sortDirection: "asc", sortBy: "leadCode" }, principal, "synthetic").items.map(item => item.id), ["new", "old"]);
  assert.deepEqual(service.listLeads({ ...query, view: "MINE", acquisitionKind: "NEW", sortBy: "createdAt", sortDirection: "asc" }, principal, "synthetic").items.map(item => item.id), ["old", "new"]);
  assert.equal(service.listLeads({ ...query, view: "MINE", acquisitionKind: "BASELINE" }, principal, "synthetic").total, 1);
  assert.equal(service.listLeads({ ...query, view: "NEW_RECEIVED", createdBefore: "2026-10-20T09:00:00.000Z" }, principal, "synthetic").total, 1);
  assert.throws(() => service.listLeads({ ...query, acquisitionKind: "HISTORICAL" }, principal, "synthetic"), /Bad Request/);
});

test("follow-up priority stays oldest due even when creation sort is requested", (t) => {
  const service = new LeadService(new AuditService());
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-20T12:00:00.000Z") });
  for (const [id, createdAt, nextActionAt] of [["first", "2026-10-20T09:00:00.000Z", "2020-01-01T00:00:00.000Z"], ["second", "2026-10-19T09:00:00.000Z", "2020-01-02T00:00:00.000Z"]]) {
    t.mock.timers.setTime(Date.parse(createdAt!));
    service.registerLocalLead({ ...input, id: id!, leadCode: `LD-SYNTH-${id}`, status: "CONTACTED", acquisitionKind: "NEW", nextActionAt: nextActionAt!, assignedToId: principal.userId });
  }
  assert.deepEqual(service.listLeads({ page: 1, pageSize: 20, view: "FOLLOW_UP", sortBy: "createdAt", sortDirection: "asc" }, principal, "synthetic").items.map(item => item.id), ["first", "second"]);
});
