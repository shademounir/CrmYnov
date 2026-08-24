import assert from "node:assert/strict";
import test from "node:test";
import { ImportWizardService } from "../src/import-wizard/import-wizard.service.js";
import { ImportWizardController } from "../src/import-wizard/import-wizard.controller.js";
import type { AuthenticatedRequest, Principal } from "../src/auth/auth.types.js";

const manager: Principal = { userId: "10000000-0000-4000-8000-000000000051", roles: ["MANAGER"], scopes: [{ kind: "CAMPUS", id: "CASABLANCA" }], sessionId: "20000000-0000-4000-8000-000000000051" };
const start = { profile: "FORMINATOR_ZAPIER" as const, fileName: "synthetic-leads.csv", fileSha256: "a".repeat(64) };
const evidence = { profileId: "profile-synthetic", sheetName: "CSV", mappingId: "mapping-synthetic", mappingVersion: 1,
  previewed: true, requiredFieldsValid: true, countersReconciled: true, collisionsResolved: true, assignmentReconciled: true, dryRunMutated: false as const };

test("requires every reconciliation gate before explicit confirmation", () => {
  const service = new ImportWizardService(); const session = service.start(start, manager);
  assert.equal(session.rawFileRetained, false); assert.equal(session.mutated, false);
  assert.throws(() => service.reconcile(session.id, { ...evidence, collisionsResolved: false }, manager), (error: unknown) => JSON.stringify(error).includes("import_wizard_not_reconciled"));
  const ready = service.reconcile(session.id, evidence, manager); assert.equal(ready.currentStep, "CONFIRMATION");
  assert.throws(() => service.confirm(session.id, "wrong", manager), (error: unknown) => JSON.stringify(error).includes("import_wizard_confirmation_refused"));
  const report = service.confirm(session.id, ready.confirmationToken!, manager);
  assert.equal(report.currentStep, "REPORT"); assert.equal(report.confirmed, true); assert.equal(report.mutated, false); assert.equal(report.rawFileRetained, false);
});

test("refuses unsafe envelopes and non-manager roles", () => {
  const service = new ImportWizardService();
  assert.throws(() => service.start({ ...start, fileName: "../real.csv" }, manager), (error: unknown) => JSON.stringify(error).includes("import_wizard_start_invalid"));
  assert.throws(() => service.start(start, { ...manager, roles: ["ADMISSIONS"] }), (error: unknown) => JSON.stringify(error).includes("import_wizard_forbidden"));
});

test("controller exposes the complete authenticated wizard contract", () => {
  const service = new ImportWizardService(); const controller = new ImportWizardController(service);
  const request = { principal: manager } as AuthenticatedRequest;
  const session = controller.start(start, request);
  const ready = controller.reconcile(session.id, evidence, request);
  assert.equal(controller.get(session.id, request).currentStep, "CONFIRMATION");
  assert.equal(controller.confirm(session.id, { confirmationToken: ready.confirmationToken! }, request).currentStep, "REPORT");
  assert.throws(() => controller.get(session.id, {} as AuthenticatedRequest), (error: unknown) => JSON.stringify(error).includes("principal_missing"));
});
