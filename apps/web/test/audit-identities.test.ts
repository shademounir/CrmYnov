import assert from "node:assert/strict";
import test from "node:test";
import { auditAction, auditActor, auditLead, auditResult, type AuditItem } from "../app/admin/audit/audit-client.js";

const item: AuditItem = { id: "00000000-0000-4000-8000-000000000001", eventType: "LEAD_UPDATED", actorId: null, actorRoles: [], campusId: null, resourceType: "LEAD", resourceId: null, result: "SUCCESS", occurredAt: "2026-10-20T22:00:00Z", before: {}, after: {} };
test("audit labels distinguish current identity, unavailable history and system without inferring from raw IDs", () => {
  assert.equal(auditActor(item).label, "Profil indisponible");
  assert.deepEqual(auditActor({ ...item, actorDisplay: { kind: "SYSTEM", label: "Ignored owner" } }), { label: "Système", note: "Exécution technique" });
  assert.deepEqual(auditActor({ ...item, actorDisplay: { kind: "CURRENT_PROFILE", label: "Nom actuel" } }), { label: "Nom actuel", note: "Profil actuel" });
  for (const label of ["", "bad\nname", "x".repeat(121)]) assert.equal(auditActor({ ...item, actorDisplay: { kind: "CURRENT_PROFILE", label } }).label, "Profil indisponible");
  assert.equal(auditAction(item), "Fiche modifiée"); assert.equal(auditResult(item), "Succès");
  assert.equal(auditAction({ ...item, eventType: "UNKNOWN_NEW_CODE" }), "Action enregistrée");
});
test("audit Lead links require a complete authorized structured identity, never arbitrary paths or stale fallbacks", () => {
  const display = { kind: "CURRENT_RECORD", id: item.id, label: "Dossier Synthétique", reference: "LD-SYNTHETIC" };
  assert.equal(auditLead({ ...item, leadDisplay: display }).href, `/leads/${item.id}`);
  for (const change of [{ id: "javascript:alert(1)" }, { label: "" }, { reference: "unsafe/contact" }, { kind: "UNAVAILABLE" }]) assert.equal(auditLead({ ...item, leadDisplay: { ...display, ...change } }).href, null);
  assert.equal(auditLead(item).href, null);
  assert.equal(auditLead({ ...item, leadDisplay: { kind: "NOT_APPLICABLE", id: null, label: null, reference: null } }).label, "Non concerné");
});
