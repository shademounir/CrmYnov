import assert from "node:assert/strict";
import test from "node:test";
import type { Principal } from "../src/auth/auth.types.js";
import { admissionsPilotageAllowed, bindAdmissionsSupervision, hasAdmissionsSupervision, readAdmissionsSupervision } from "../src/reporting/admissions-supervision.js";
import type { PermissionTransaction } from "../src/permissions/dynamic-repository.js";
import type { ConfigurationSnapshot } from "../src/permissions/dynamic-contract.js";
import { defaultConfiguration } from "../src/permissions/dynamic-evaluator.js";
import { isPersonalReportingRequest, normalizeScopedReportingQuery } from "../src/reporting/reporting-filter.js";
const commercial = (): Principal => ({ userId: "synthetic", sessionId: "synthetic-session", roles: ["ADMISSIONS"], scopes: [{ kind: "CAMPUS", id: "campus-a" }] });
const context = { campus: "campus-a", active: true, own: false, team: false, campusAllowed: true, globalAllowed: false };
test("functional Admissions designation grants only campus pilotage reads, never a role-wide grant", () => {
  const actor = commercial(); assert.equal(hasAdmissionsSupervision(actor), false); assert.equal(isPersonalReportingRequest({}, actor), true);
  const clear = bindAdmissionsSupervision(actor, new Set(["campus-a"]));
  try {
    assert.equal(isPersonalReportingRequest({}, actor), false);
    assert.equal(normalizeScopedReportingQuery({}, actor).view, "global");
    assert.equal(admissionsPilotageAllowed(actor, "reporting.pilotage.view", [], context), true);
    for (const key of ["lead.edit", "lead.assign", "lead.reassign.approve", "lead.close.approve", "reporting.export", "users.view", "appointment.manage"]) assert.equal(admissionsPilotageAllowed(actor, key, [], context), false);
    assert.equal(admissionsPilotageAllowed(actor, "reporting.pilotage.view", [], { ...context, campus: "campus-b" }), false);
    assert.equal(admissionsPilotageAllowed(actor, "reporting.pilotage.view", [], { ...context, campusAllowed: false }), false);
    assert.equal(admissionsPilotageAllowed({ ...actor }, "reporting.pilotage.view", [], context), false, "not serializable or copied through a browser payload");
    assert.equal(isPersonalReportingRequest({ view: "personal" }, actor), true);
  } finally { clear(); }
  assert.equal(hasAdmissionsSupervision(actor), false); assert.equal(isPersonalReportingRequest({}, actor), true);
});
test("responsibility is freshly loaded, active, same canonical campus and activated Commercial account", async () => {
  const actor = commercial(); let active = true, activated = true, hasDesignation = true, campusScope = true;
  const tx = {
    collaborator: { findUnique: () => Promise.resolve({ id: actor.userId, active, firstLoginRequired: !activated, roles: ["ADMISSIONS"], campusId: "00000000-0000-4000-8000-000000000038" }) },
    crmReference: { findUnique: () => Promise.resolve({ id: "campus-a", kind: "CAMPUS", state: "ACTIVE", code: "CASABLANCA", label: "Campus synthétique" }) },
    crmReferenceKey: { findMany: () => Promise.resolve([]) },
    admissionsResponsibility: { findMany: ({ where }: { where: { userId: string; active: boolean; campus: { in: string[] } } }) => { assert.equal(where.userId, actor.userId); assert.equal(where.active, true); assert(where.campus.in.includes("CASABLANCA")); return Promise.resolve(hasDesignation ? [{ campus: "CASABLANCA" }] : []); } },
  } as unknown as PermissionTransaction;
  const load = (): Promise<ReadonlySet<string>> => readAdmissionsSupervision(tx, campusScope ? actor : { ...actor, scopes: [{ kind: "CAMPUS", id: "foreign" }] });
  assert.deepEqual([...await load()], ["campus-a"]);
  hasDesignation = false; assert.equal((await load()).size, 0);
  hasDesignation = true; active = false; assert.equal((await load()).size, 0);
  active = true; activated = false; assert.equal((await load()).size, 0);
  activated = true; campusScope = false; assert.equal((await load()).size, 0);
});
test("functional pilotage respects explicit global/campus ceilings, including OWN/TEAM restrictions", () => {
  const actor = commercial(), clear = bindAdmissionsSupervision(actor, new Set(["campus-a"]));
  try { for (const campus of ["GLOBAL", "campus-a"]) for (const scope of ["NONE", "OWN", "TEAM"] as const) {
    const target = { kind: "CEILING" as const, role: "*" as const, campus };
    const row: ConfigurationSnapshot = { ...target, id: "synthetic", version: 1, grants: { ...defaultConfiguration(target), "reporting.pilotage.view": scope } };
    assert.equal(admissionsPilotageAllowed(actor, "reporting.pilotage.view", [row], context), false);
  } } finally { clear(); }
});
