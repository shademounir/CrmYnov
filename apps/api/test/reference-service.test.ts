import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DefaultGrantProvider, PermissionService } from "../src/permissions/permission.service.js";
import { ReferenceService } from "../src/references/reference.service.js";
import { referenceStore } from "./helpers/reference-store.js";
import type { Principal, Role } from "../src/auth/auth.types.js";
import type { ReferenceInput } from "../src/references/reference.contract.js";
import type { TagAssignment } from "../src/references/reference.contract.js";
import { validateLeadReferences } from "../src/references/reference.repository.js";

const actor = (role: Role, campus = "SYNTHETIC"): Principal => ({ userId: "synthetic-actor", roles: [role], scopes: [{ kind: "CAMPUS", id: campus }], sessionId: "synthetic-session" });
const superAdmin = actor("SUPER_ADMIN");
const hasCode = (code: string) => (error: unknown): boolean => error instanceof HttpException && JSON.stringify(error.getResponse()).includes(code);
const definition = (kind: ReferenceInput["kind"], code = "SYNTHETIC"): ReferenceInput => ({ kind, code, label: code, scope: "GLOBAL", campusId: null });
async function setup(): Promise<ReturnType<typeof referenceStore> & { service: ReferenceService; campusId: string; programId: string }> {
  const store = referenceStore(); const service = new ReferenceService(store.repository, new PermissionService(new DefaultGrantProvider()));
  const campus = await service.create(definition("CAMPUS"), superAdmin, "setup-campus");
  const program = await service.create(definition("PROGRAM", "B1"), superAdmin, "setup-program");
  await service.availability(program.id, campus.id, true, 0, superAdmin, "setup-availability");
  await service.create(definition("CAMPAIGN"), superAdmin, "setup-campaign");
  return { ...store, service, campusId: campus.id, programId: program.id };
}
test("governed definitions: normalization, collision rollback, append-only aliases, archive and restore", async () => {
  const { service, rows } = await setup();
  const tag = await service.create({ ...definition("TAG", " PRIORITÉ "), aliases: ["Urgent"] }, superAdmin, "create-tag");
  assert.equal(tag.code, "PRIORITÉ");
  const auditCount = rows.auditEvent.length;
  await assert.rejects(() => service.create(definition("TAG", "urgent"), superAdmin, "collision"), hasCode("reference_canonical_conflict"));
  assert.equal(rows.auditEvent.length, auditCount); assert.equal(rows.crmReference.filter((row) => row.kind === "TAG").length, 1);
  const updated = await service.update(tag.id, { label: "Priorité admission", aliases: ["Priorité"], expectedVersion: 1 }, superAdmin, "rename");
  assert.equal(updated.version, 2); assert.ok(rows.crmReferenceKey.some((row) => row.key === "URGENT"));
  await assert.rejects(() => service.update(tag.id, { expectedVersion: 1, state: "ARCHIVED" }, superAdmin, "stale"), hasCode("reference_version_conflict"));
  const archived = await service.update(tag.id, { expectedVersion: 2, state: "ARCHIVED" }, superAdmin, "archive");
  assert.equal((await service.list("TAG", actor("MANAGER"), { includeArchived: true })).length, 0);
  assert.equal((await service.list("TAG", superAdmin, { includeArchived: true }))[0]?.state, "ARCHIVED");
  const restored = await service.update(tag.id, { expectedVersion: archived.version, state: "ACTIVE" }, superAdmin, "restore");
  assert.equal(restored.state, "ACTIVE"); assert.equal(rows.auditEvent.length, auditCount + 3);
});
test("default grants constrain reference mutations and campus availability", async () => {
  const { service, campusId, programId } = await setup();
  for (const role of ["ADMIN", "MANAGER", "ADMISSIONS", "AUDITOR"] as const) await assert.rejects(() => service.create(definition("TAG"), actor(role), "denied"), hasCode("permission_denied"));
  const tag = await service.create({ ...definition("TAG"), scope: "CAMPUS", campusId }, actor("ADMIN"), "admin-create");
  assert.equal(tag.campusId, campusId);
  await assert.rejects(() => service.update(tag.id, { expectedVersion: 1, label: "Refusé" }, actor("ADMIN", "OTHER"), "other"), hasCode("permission_denied"));
  const available = await service.availability(programId, campusId, false, 1, actor("ADMIN"), "admin-availability"); assert.equal(available.active, false);
  assert.equal((await service.list("PROGRAM", actor("MANAGER"), { campusId })).length, 0);
  await assert.rejects(() => service.availability(programId, campusId, true, 1, superAdmin, "stale-availability"), hasCode("reference_version_conflict"));
  await service.availability(programId, campusId, true, 2, superAdmin, "reactivate");
  assert.equal((await service.list("PROGRAM", actor("MANAGER"), { campusId })).length, 1);
  await assert.rejects(() => service.list("PROGRAM", actor("MANAGER", "OTHER"), { campusId }), hasCode("permission_denied"));
  await assert.rejects(() => service.readAvailability(programId, campusId, actor("ADMIN", "OTHER")), hasCode("permission_denied"));
  assert.deepEqual(await service.readAvailability(programId, campusId, actor("ADMIN")), { active: true, version: 3 });
});

test("Lecteur sees only references used by the readable lead; campaign aliases prevent unsafe scope changes", async () => {
  const { service, rows, campusId, programId } = await setup(); const leadId = randomUUID();
  const campaign = await service.create({ ...definition("CAMPAIGN", "CAMPAIGN-ALIAS"), aliases: ["Ancienne campagne"] }, superAdmin, "alias");
  await service.create(definition("PROGRAM", "UNUSED"), superAdmin, "unused");
  rows.lead.push({ id: leadId, campus: "SYNTHETIC", program: "B1", campaign: " ancienne campagne ", version: 1 });
  assert.deepEqual(await service.list("PROGRAM", actor("AUDITOR")), []);
  assert.deepEqual((await service.list("PROGRAM", actor("AUDITOR"), { leadId })).map((row) => row.id), [programId]);
  await assert.rejects(() => service.update(campaign.id, { scope: "CAMPUS", campusId, expectedVersion: 1 }, superAdmin, "move"), hasCode("reference_scope_in_use"));
  const otherCampus = await service.create(definition("CAMPUS", "OTHER"), superAdmin, "other-campus");
  assert.deepEqual(await service.readAvailability(programId, otherCampus.id, superAdmin), { active: false, version: 0 });
});
test("tag add/remove/replace, idempotency, optimistic concurrency, ownership, anti-IDOR, timeline and audit", async () => {
  const { service, rows, campusId } = await setup(); const leadId = randomUUID();
  rows.lead.push({ id: leadId, campus: "SYNTHETIC", program: "B1", campaign: "SYNTHETIC", assignedToId: "synthetic-actor", version: 1 });
  const a = await service.create(definition("TAG", "A"), superAdmin, "tag-a");
  const b = await service.create({ ...definition("TAG", "B"), scope: "CAMPUS", campusId }, actor("ADMIN"), "tag-b");
  const input = { tagIds: [a.id], expectedVersion: 1, idempotencyKey: "synthetic-tag-01" };
  await assert.rejects(() => service.assignTags(leadId, { tagIds: [a.id], expectedVersion: 1 } as TagAssignment, actor("MANAGER"), "missing-key"), hasCode("tag_assignment_invalid"));
  const assigned = await service.assignTags(leadId, input, actor("ADMISSIONS"), "tag-add"); assert.equal(assigned.version, 2);
  assert.deepEqual(await service.assignTags(leadId, input, actor("ADMISSIONS"), "replay"), assigned);
  await assert.rejects(() => service.assignTags(leadId, { ...input, tagIds: [b.id] }, actor("ADMISSIONS"), "collision"), hasCode("tag_idempotency_conflict"));
  await assert.rejects(() => service.assignTags(leadId, { ...input, idempotencyKey: "synthetic-stale" }, actor("MANAGER"), "stale"), hasCode("lead_version_conflict"));
  await assert.rejects(() => service.assignTags(leadId, { ...input, expectedVersion: 2 }, actor("AUDITOR"), "reader"), hasCode("permission_denied"));
  await assert.rejects(() => service.leadTags(leadId, actor("MANAGER", "OTHER")), hasCode("lead_not_found"));
  await assert.rejects(() => service.assignTags(leadId, { ...input, expectedVersion: 2 }, { ...actor("ADMISSIONS"), userId: "other-adviser" }, "viewer"), hasCode("permission_denied"));
  await service.assignTags(leadId, { tagIds: [b.id], expectedVersion: 2, idempotencyKey: "synthetic-tag-02" }, actor("MANAGER"), "replace");
  await service.assignTags(leadId, { tagIds: [], expectedVersion: 3, idempotencyKey: "synthetic-tag-03" }, actor("MANAGER"), "remove");
  assert.equal((await service.leadTags(leadId, actor("AUDITOR"))).items.length, 0);
  assert.equal(rows.leadActivity.length, 3); assert.equal(rows.auditEvent.filter((row) => row.eventType === "LEAD_TAGS_CHANGED").length, 3);
  assert.equal(rows.crmLeadTag.length, 2); assert.ok(rows.crmLeadTag.every((row) => row.active === false));
  await assert.rejects(() => service.update(b.id, { expectedVersion: 1, scope: "GLOBAL", campusId: null }, superAdmin, "move-in-use"), hasCode("reference_scope_in_use"));
});
test("failed transaction rolls back tags, lead version, timeline and business audit", async () => {
  const { service, rows, failAudit } = await setup(); const leadId = randomUUID();
  rows.lead.push({ id: leadId, campus: "SYNTHETIC", version: 1 }); const tag = await service.create(definition("TAG"), superAdmin, "tag");
  const audits = rows.auditEvent.length; failAudit();
  await assert.rejects(() => service.assignTags(leadId, { tagIds: [tag.id], expectedVersion: 1, idempotencyKey: "synthetic-rollback" }, superAdmin, "rollback"), hasCode("reference_store_unavailable"));
  assert.equal(rows.lead[0]?.version, 1); assert.equal(rows.crmLeadTag.length, 0); assert.equal(rows.leadActivity.length, 0); assert.equal(rows.auditEvent.length, audits);
});

test("tag ordering is explicit and replay ignores input order without duplicating timeline or audit", async () => {
  const { service, rows } = await setup(); const leadId = randomUUID();
  rows.lead.push({ id: leadId, campus: "SYNTHETIC", version: 1 });
  const first = await service.create(definition("TAG", "SORT-FIRST"), superAdmin, "first-tag");
  const second = await service.create(definition("TAG", "SORT-SECOND"), superAdmin, "second-tag");
  const ordered = [first.id, second.id].sort((left, right) => left.localeCompare(right, "en"));
  const audits = rows.auditEvent.length;
  const result = await service.assignTags(leadId, { tagIds: [...ordered].reverse(), expectedVersion: 1, idempotencyKey: "synthetic-sort-replay" }, superAdmin, "sort");
  assert.deepEqual(result, { tagIds: ordered, version: 2 });
  const replay = await service.assignTags(leadId, { tagIds: ordered, expectedVersion: 1, idempotencyKey: "synthetic-sort-replay" }, superAdmin, "sort-replay");
  assert.deepEqual(replay, result);
  assert.equal(rows.lead[0]?.version, 2);
  assert.equal(rows.leadActivity.length, 1);
  assert.equal(rows.auditEvent.length, audits + 1);
  assert.equal(rows.crmLeadTag.filter((row) => row.active).length, 2);
});
test("legacy strings remain exact; unrelated edits survive; new unknown values fail with sanitized 422", async () => {
  const { service, rows } = await setup(); const id = randomUUID();
  rows.lead.push({ id, campus: "SYNTHETIC", program: "Ancien libellé ", campaign: "Historique", version: 1 });
  const before = structuredClone(rows.lead);
  assert.equal((await service.captureLegacy(superAdmin, "legacy")).created, 2);
  assert.equal((await service.captureLegacy(superAdmin, "legacy-replay")).created, 0);
  assert.deepEqual(rows.lead, before); assert.ok(rows.crmReference.some((row) => row.label === "Ancien libellé " && row.state === "LEGACY"));
  await service.validateForLead({}, actor("ADMISSIONS"), id);
  await assert.rejects(() => service.validateForLead({ program: "unknown" }, actor("ADMISSIONS", "OTHER"), id), hasCode("lead_not_found"));
  await assert.rejects(() => service.validateForLead({ program: "unknown" }, actor("ADMISSIONS"), id), hasCode("REFERENCE_VALUE_UNKNOWN"));
  await service.validateForLead({ campus: "SYNTHETIC", program: "B1", campaign: "SYNTHETIC" }, actor("ADMISSIONS"));
  const legacy = rows.crmReference.find((row) => row.state === "LEGACY")!;
  await assert.rejects(() => service.update(String(legacy.id), { expectedVersion: 1, state: "ACTIVE" }, superAdmin, "legacy-restore"), hasCode("reference_legacy_immutable"));
});

test("reference validation preserves untouched legacy values and validates only changed fields", async () => {
  const { repository, rows } = await setup();
  const historical = { campus: "Unknown historical campus ", program: "Legacy programme ", campaign: "Legacy campaign " };
  const before = structuredClone(rows);
  assert.deepEqual(await repository.transaction((tx) => validateLeadReferences(tx, historical, historical)), historical);
  const previous = { campus: "SYNTHETIC", program: "Legacy programme ", campaign: "Legacy campaign " };
  const updated = { ...previous, campaign: " synthetic " };
  assert.deepEqual(await repository.transaction((tx) => validateLeadReferences(tx, updated, previous)), { ...previous, campaign: "SYNTHETIC" });
  assert.deepEqual(rows, before, "validation alone must not mutate definitions, leads or audits");
});

test("reference validation stays fail closed for missing, archived and unavailable references", async () => {
  const { repository, rows, service, campusId, programId } = await setup();
  const values = { campus: "SYNTHETIC", program: "B1", campaign: "SYNTHETIC" };
  for (const field of ["campus", "program", "campaign"] as const) {
    await assert.rejects(() => repository.transaction((tx) => validateLeadReferences(tx, { ...values, [field]: "UNKNOWN" })), hasCode("REFERENCE_VALUE_UNKNOWN"));
  }
  await service.availability(programId, campusId, false, 1, superAdmin, "validation-disable");
  await assert.rejects(() => repository.transaction((tx) => validateLeadReferences(tx, values)), hasCode("REFERENCE_VALUE_UNKNOWN"));
  await service.availability(programId, campusId, true, 2, superAdmin, "validation-enable");
  for (const kind of ["CAMPUS", "PROGRAM", "CAMPAIGN"]) {
    const row = rows.crmReference.find((item) => item.kind === kind)!;
    row.state = "ARCHIVED";
    await assert.rejects(() => repository.transaction((tx) => validateLeadReferences(tx, values)), hasCode("REFERENCE_VALUE_UNKNOWN"));
    rows.crmReference.find((item) => item.id === row.id)!.state = "ACTIVE";
  }
});

test("changing campus revalidates unchanged program and campaign in the destination campus", async () => {
  const { repository, service, programId } = await setup();
  const other = await service.create(definition("CAMPUS", "OTHER"), superAdmin, "validation-other");
  const previous = { campus: "SYNTHETIC", program: "B1", campaign: "SYNTHETIC" };
  const next = { ...previous, campus: " other " };
  await assert.rejects(() => repository.transaction((tx) => validateLeadReferences(tx, next, previous)), hasCode("REFERENCE_VALUE_UNKNOWN"));
  await service.availability(programId, other.id, true, 0, superAdmin, "validation-other-enable");
  assert.deepEqual(await repository.transaction((tx) => validateLeadReferences(tx, next, previous)), { ...previous, campus: "OTHER" });
});
