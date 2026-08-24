import assert from "node:assert/strict";
import test from "node:test";
import type { Principal } from "../src/auth/auth.types.js";
import { AuditService } from "../src/audit/audit.service.js";
import { LeadService, type LeadStatus } from "../src/leads/lead.service.js";
import { CommercialFunnelController } from "../src/reporting/commercial-funnel.controller.js";
import { CommercialFunnelService } from "../src/reporting/commercial-funnel.service.js";

const manager: Principal = { userId: "manager-synthetic", roles: ["MANAGER"], scopes: [{ kind: "CAMPUS", id: "Casablanca synthétique" }], sessionId: "session-synthetic" };
const globalManager: Principal = { ...manager, scopes: [{ kind: "GLOBAL" }] };
const adviser: Principal = { userId: "adviser-synthetic", roles: ["ADMISSIONS"], scopes: [{ kind: "GLOBAL" }], sessionId: "session-adviser" };
const hasCode = (code: string) => (error: unknown): boolean => JSON.stringify(error).includes(code);

function setup(): { audit: AuditService; leads: LeadService; service: CommercialFunnelService } {
  const audit = new AuditService(); const leads = new LeadService(audit); return { audit, leads, service: new CommercialFunnelService(leads, audit) };
}
function add(leads: LeadService, code: string, status: LeadStatus, campus = "Casablanca synthétique", source = "FORMINATOR_ZAPIER"): void {
  leads.registerLocalLead({ leadCode: code, firstName: "Lead", lastName: "Synthétique", campus, campaign: "Campagne synthétique",
    educationLevel: "BAC", program: "Programme synthétique", source, status });
}

test("computes one current state per lead with versioned, explicit formulas", () => {
  const { audit, leads, service } = setup();
  add(leads, "LD-001", "PROSPECT"); add(leads, "LD-002", "CONTACTED"); add(leads, "LD-003", "QUALIFIED"); add(leads, "LD-004", "ENROLLED"); add(leads, "LD-005", "CLOSED_LOST");
  const result = service.read({ campus: "Casablanca synthétique", source: "FORMINATOR_ZAPIER" }, manager, "corr-funnel");
  assert.equal(result.cohort.totalUniqueLeads, 5);
  assert.deepEqual(result.currentState, { PROSPECT: 1, CONTACTED: 1, QUALIFIED: 1, ENROLLED: 1, CLOSED_LOST: 1 });
  assert.deepEqual(result.attainment, { contactedOrBeyond: 3, qualifiedOrBeyond: 2, enrolled: 1 });
  assert.deepEqual(result.rates, { contactedOrBeyond: 0.6, qualifiedOrBeyond: 0.4, enrolled: 0.2 });
  assert.equal(result.definitionVersion, "commercial-funnel-v1"); assert.equal(result.timezone, "Africa/Casablanca");
  assert.ok(result.definitions.every((definition) => definition.denominator && definition.formula));
  const event = audit.list().find((item) => item.eventType === "COMMERCIAL_FUNNEL_VIEWED");
  assert.deepEqual(event?.after?.activeFilterNames, ["campus", "source"]); assert.equal(JSON.stringify(event).includes("FORMINATOR_ZAPIER"), false);
});

test("combines period and business filters, scopes campuses and returns null rates for an empty cohort", () => {
  const { leads, service } = setup(); add(leads, "LD-A", "CONTACTED"); add(leads, "LD-B", "ENROLLED", "Rabat synthétique");
  const now = new Date(); const from = new Date(now.valueOf() - 60_000).toISOString(); const to = new Date(now.valueOf() + 60_000).toISOString();
  assert.equal(service.read({ from, to, campaign: "Campagne synthétique", program: "Programme synthétique" }, manager, "scoped").cohort.totalUniqueLeads, 1);
  assert.equal(service.read({ campus: "Rabat synthétique" }, globalManager, "global").cohort.totalUniqueLeads, 1);
  assert.deepEqual(service.read({ source: "ABSENT" }, manager, "empty").rates, { contactedOrBeyond: null, qualifiedOrBeyond: null, enrolled: null });
  assert.throws(() => service.read({ from: "invalid" }, manager, "invalid"), hasCode("funnel_from_invalid"));
  assert.throws(() => service.read({ from: to, to: from }, manager, "range"), hasCode("funnel_period_invalid"));
  assert.throws(() => service.read({}, adviser, "forbidden"), hasCode("reporting_manager_required"));
});

test("handles a reasonable synthetic volume and exposes no lead identity", () => {
  const { leads, service } = setup();
  for (let index = 0; index < 2_000; index += 1) add(leads, `LD-VOLUME-${index}`, index % 2 ? "CONTACTED" : "PROSPECT");
  const serialized = JSON.stringify(service.read({}, manager, "volume"));
  assert.match(serialized, /"totalUniqueLeads":2000/); assert.equal(serialized.includes("LD-VOLUME"), false); assert.equal(serialized.includes("firstName"), false);
});

test("controller fails closed without an authenticated principal", () => {
  const { service } = setup(); const controller = new CommercialFunnelController(service);
  assert.throws(() => controller.read({}, {} as never), hasCode("principal_missing"));
  assert.equal(controller.read({}, { principal: manager, header: () => "corr-controller" } as never).cohort.totalUniqueLeads, 0);
});
