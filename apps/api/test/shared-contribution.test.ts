import assert from "node:assert/strict"; import test from "node:test";
import type { Principal } from "../src/auth/auth.types.js"; import { AuditService } from "../src/audit/audit.service.js"; import { LeadService } from "../src/leads/lead.service.js"; import { SharedContributionService } from "../src/reporting/shared-contribution.service.js";
const manager: Principal = { userId: "manager-synthetic", roles: ["MANAGER"], scopes: [{ kind: "GLOBAL" }], sessionId: "session-manager" };
const collaborator: Principal = { userId: "adviser-b", roles: ["ADMISSIONS"], scopes: [{ kind: "GLOBAL" }], sessionId: "session-b" };
test("separates authorized secondary actions without double-attributing enrollment", () => {
  const audit = new AuditService(); const leads = new LeadService(audit); const service = new SharedContributionService(leads, audit);
  const lead = leads.registerLocalLead({ id: "lead-shared", leadCode: "LD-SHARED", firstName: "Lead", lastName: "Synthétique", campus: "Campus synthétique", campaign: "Campagne", educationLevel: "BAC", program: "Programme", source: "WEB_FORM", assignedToId: "adviser-a", collaboratorIds: ["adviser-b"], status: "ENROLLED" });
  leads.addActivity(lead.id, { type: "COMMENT", result: "SYNTHETIC" }, collaborator, "corr-secondary");
  const report = service.read({}, manager, "corr-report"); const row = report.contributors.find((item) => item.contributorId === "adviser-b")!;
  assert.equal(row.collaborativeLeadCount, 1); assert.equal(row.secondaryActionCount, 1); assert.equal(row.secondaryEnrollmentCount, 0);
  assert.equal(report.uniqueLeadCount, 1); assert.deepEqual(report.safeguards, { conversionsAttributedToPrimaryOnly: true, compensationCalculated: false, disciplinaryRanking: false });
});
test("limits an adviser to their own contribution line and rejects invalid dates", () => { const audit = new AuditService(); const leads = new LeadService(audit); const service = new SharedContributionService(leads, audit); leads.registerLocalLead({ leadCode: "LD-OWN", firstName: "Lead", lastName: "Synthétique", campus: "Campus", campaign: "Campagne", educationLevel: "BAC", program: "Programme", source: "WEB_FORM", assignedToId: "adviser-a", collaboratorIds: ["adviser-b"] }); assert.deepEqual(service.read({}, collaborator, "corr-own").contributors.map((item) => item.contributorId), ["adviser-b"]); assert.throws(() => service.read({ from: "invalid" }, manager, "corr-invalid")); });
