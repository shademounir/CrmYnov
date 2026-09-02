import assert from "node:assert/strict";
import test from "node:test";
import { AuditService } from "../src/audit/audit.service.js";
import type { Principal } from "../src/auth/auth.types.js";
import { LeadController } from "../src/leads/lead.controller.js";
import { LeadService } from "../src/leads/lead.service.js";

const adviser: Principal = { userId: "adviser-a", roles: ["ADMISSIONS"], scopes: [{ kind: "CAMPUS", id: "Campus A" }], sessionId: "synthetic-session" };
const manager: Principal = { userId: "manager-a", roles: ["MANAGER"], scopes: [{ kind: "GLOBAL" }], sessionId: "synthetic-manager" };
const hasCode = (code: string) => (error: unknown): boolean => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes(code);

function fixture(): { audit: AuditService; leads: LeadService; controller: LeadController; leadId: string } {
  const audit = new AuditService(); const leads = new LeadService(audit);
  const lead = leads.registerLocalLead({ leadCode: "LD-EDIT-001", firstName: "Alex", lastName: "Synthetic", email: "ALEX@EXAMPLE.INVALID", phone: "+212 600 000 001", campus: "Campus A", campaign: "Campaign", educationLevel: "BAC", program: "Program", source: "TEST", assignedToId: adviser.userId, version: 1 });
  return { audit, leads, controller: new LeadController(leads), leadId: lead.id };
}

test("updates an assigned lead partially, normalizes contacts, and appends an audit event", async () => {
  const { audit, leads, leadId } = fixture();
  const updated = await leads.updateLeadForApi(leadId, { firstName: "  Alice  ", email: " ALICE@EXAMPLE.INVALID ", phone: "+212 (600) 000 002", expectedVersion: 1, idempotencyKey: "edit-success" }, adviser, "corr-edit");
  assert.equal(updated.firstName, "Alice"); assert.equal(updated.lastName, "Synthetic"); assert.equal(updated.email, "alice@example.invalid"); assert.equal(updated.phone, "+212600000002");
  assert.equal(audit.list().filter((event) => event.eventType === "LEAD_UPDATED").length, 1);
});

test("preserves absent optional fields and clears only explicit empty optional contacts", async () => {
  const { leads, leadId } = fixture();
  const unchanged = await leads.updateLeadForApi(leadId, { campaign: "Campaign 2", idempotencyKey: "edit-partial" }, adviser, "corr-partial");
  assert.equal(unchanged.email, "ALEX@EXAMPLE.INVALID"); assert.equal(unchanged.phone, "+212 600 000 001");
  const cleared = await leads.updateLeadForApi(leadId, { email: "", phone: "", idempotencyKey: "edit-clear" }, adviser, "corr-clear");
  assert.equal(cleared.email, undefined); assert.equal(cleared.phone, undefined);
});

test("rejects invalid input, stale versions, unknown leads, and records no success audit on failure", async () => {
  const { audit, leads, leadId } = fixture();
  await assert.rejects(() => leads.updateLeadForApi(leadId, { email: "invalid", idempotencyKey: "edit-invalid-email" }, adviser, "corr-invalid"), hasCode("lead_email_invalid"));
  await assert.rejects(() => leads.updateLeadForApi(leadId, { phone: "12", idempotencyKey: "edit-invalid-phone" }, adviser, "corr-phone"), hasCode("lead_phone_invalid"));
  await assert.rejects(() => leads.updateLeadForApi(leadId, { firstName: "Alice", expectedVersion: 2, idempotencyKey: "edit-stale" }, adviser, "corr-stale"), hasCode("lead_version_conflict"));
  await assert.rejects(() => leads.updateLeadForApi("missing", { firstName: "Alice", idempotencyKey: "edit-missing" }, adviser, "corr-missing"), hasCode("lead_not_found"));
  assert.equal(audit.list().filter((event) => event.eventType === "LEAD_UPDATED").length, 0);
});

test("fails closed for an unrelated adviser, another campus, and an unauthenticated controller request", async () => {
  const { leads, controller, leadId } = fixture();
  const unrelated: Principal = { ...adviser, userId: "adviser-b" };
  const otherCampus: Principal = { ...adviser, scopes: [{ kind: "CAMPUS", id: "Campus B" }] };
  await assert.rejects(() => leads.updateLeadForApi(leadId, { firstName: "Alice", idempotencyKey: "edit-idor" }, unrelated, "corr-idor"), hasCode("lead_collaboration_required"));
  await assert.rejects(() => leads.updateLeadForApi(leadId, { firstName: "Alice", idempotencyKey: "edit-campus" }, otherCampus, "corr-campus"), hasCode("lead_campus_forbidden"));
  await assert.rejects(() => controller.update(leadId, { firstName: "Alice", idempotencyKey: "edit-auth" }, { header: () => undefined } as never), hasCode("principal_missing"));
  const request = { principal: manager, header: () => "corr-controller" } as never;
  assert.equal((await controller.update(leadId, { source: "MANUAL", idempotencyKey: "edit-controller" }, request)).source, "MANUAL");
});

test("linear email validation preserves the existing syntax and normalization contract", async () => {
  for (const email of [" ALEX@EXAMPLE.INVALID ", "a+b@sub.example.invalid", "a.b@x.invalid", "é@x.invalid", "a@..b", "a@x..", "a@x.y.z"]) {
    const { leads, leadId, audit } = fixture();
    const updated = await leads.updateLeadForApi(leadId, { email, idempotencyKey: "email-syntax-valid" }, adviser, "syntax-valid");
    assert.equal(updated.email, email.trim().toLowerCase());
    assert.equal(updated.campus, "Campus A");
    assert.equal(audit.list().filter((event) => event.eventType === "LEAD_UPDATED").length, 1);
  }
  for (const email of ["@x.invalid", "a@x", "a@.b", "a@b.", "a@@x.invalid", "a b@x.invalid", "a@x. invalid", "a\t@x.invalid", "a@x\u00a0.invalid"]) {
    const { leads, leadId, audit } = fixture();
    await assert.rejects(() => leads.updateLeadForApi(leadId, { email, idempotencyKey: "email-syntax-invalid" }, adviser, "syntax-invalid"), hasCode("lead_email_invalid"));
    assert.equal(leads.findLocalLead(leadId)?.email, "ALEX@EXAMPLE.INVALID");
    assert.equal(audit.list().filter((event) => event.eventType === "LEAD_UPDATED").length, 0);
  }
});

test("long synthetic email inputs finish without backtracking or success audit on rejection", { timeout: 5000 }, async () => {
  const { leads, leadId, audit } = fixture();
  for (const email of [`a@${"a".repeat(100_000)}`, `a@${"a.".repeat(50_000)}@invalid`, `${"a".repeat(100_000)}@.b`]) {
    await assert.rejects(() => leads.updateLeadForApi(leadId, { email, idempotencyKey: "email-long-invalid" }, adviser, "long-invalid"), hasCode("lead_email_invalid"));
  }
  assert.equal(leads.findLocalLead(leadId)?.email, "ALEX@EXAMPLE.INVALID");
  assert.equal(audit.list().filter((event) => event.eventType === "LEAD_UPDATED").length, 0);
});
