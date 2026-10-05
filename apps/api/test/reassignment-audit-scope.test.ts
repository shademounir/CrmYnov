/* eslint-disable @typescript-eslint/require-await */
import assert from "node:assert/strict";
import test from "node:test";
import type { Lead, Prisma, AuditEvent } from "@prisma/client";
import { appendReassignmentEffect, boundedReassignmentResults, reassignmentCampusKeys } from "../src/assignment/reassignment-persistence.js";
import { auditView } from "../src/audit/audit-view.js";
import type { ReassignmentRequest } from "../src/assignment/reassignment.service.js";
import { assignmentNotification } from "../src/assignment/assignment-notifications.js";

const campusId = "00000000-0000-4000-8000-000000000094";
const leadId = "00000000-0000-4000-8000-000000000095";

test("assignment notifications link only to the real Lead and assignment workflow routes", async () => {
  const notifications: Prisma.InternalNotificationUncheckedCreateInput[] = [];
  const tx = { internalNotification: { create: async ({ data }: { data: Prisma.InternalNotificationUncheckedCreateInput }) => { notifications.push(data); return data; } } } as unknown as Prisma.TransactionClient;
  await assignmentNotification(tx, "new-owner", leadId, "ASSIGNMENT", "initial-key");
  await assignmentNotification(tx, "manager", leadId, "ASSIGNMENT", "pending-key", "/collaborators");
  await assignmentNotification(tx, "requester", leadId, "REASSIGNMENT_DECISION", "decision-key", "/collaborators");
  assert.deepEqual(notifications.map((row) => row.href), [`/leads/${leadId}`, `/leads/${leadId}/collaborators`, `/leads/${leadId}/collaborators`]);
  assert.equal(new Set(notifications.map((row) => row.deduplicationKey)).size, 3);
});

test("request scan checks permissions before the result cap and fails honestly if its bound is exhausted", async () => {
  const rows = Array.from({ length: 1_001 }, (_, id) => id);
  let checked = 0;
  const visible = await boundedReassignmentResults(rows, async (id) => { checked += 1; return id >= 100 ? id : undefined; });
  assert.equal(visible.length, 100);
  assert.equal(visible[0], 100);
  assert.equal(checked, 200);
  checked = 0;
  await assert.rejects(() => boundedReassignmentResults(rows, async () => { checked += 1; return undefined; }),
    (error: unknown) => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes("reassignment_queue_scan_limit"));
  assert.equal(checked, 1_000);
  assert.deepEqual(await boundedReassignmentResults(rows.slice(0, 999), async () => undefined), []);
});

test("list scope includes UUID, canonical code, label and declared aliases of only the persisted campus", async () => {
  const campus = { id: campusId, kind: "CAMPUS", code: "CAMPUS_CODE", label: "Campus synthétique", state: "ACTIVE" };
  let canonicalReads = 0;
  const tx = {
    crmReference: { findUnique: async () => { canonicalReads += 1; return campus; } },
    crmReferenceKey: { findMany: async ({ where }: { where: { referenceId?: string; key?: string } }) => where.referenceId
      ? [{ key: "CAMPUS_CODE" }, { key: "CAMPUS_ALIAS" }] : where.key === "campus_code" ? [{ reference: campus }] : [] },
  } as unknown as Prisma.TransactionClient;
  assert.deepEqual(await reassignmentCampusKeys(tx, [{ kind: "CAMPUS", id: campusId }, { kind: "CAMPUS", id: campus.code },
    { kind: "CAMPUS", id: campus.label }, { kind: "TEAM", id: "foreign-team" }]),
    [campusId, "CAMPUS_CODE", "Campus synthétique", "CAMPUS_ALIAS"]);
  assert.equal(canonicalReads, 1);
  assert.deepEqual(await reassignmentCampusKeys(tx, [{ kind: "GLOBAL" }]), []);
  await assert.rejects(() => reassignmentCampusKeys(tx, [{ kind: "CAMPUS", id: campusId }, { kind: "CAMPUS", id: "unknown-campus" }]),
    (error: unknown) => (error as { getStatus(): number }).getStatus() === 403);
});

test("new reassignment audits store the canonical campus UUID retained by the audit API", async () => {
  const audits: Prisma.AuditEventUncheckedCreateInput[] = [];
  const tx = {
    crmReferenceKey: { findMany: async ({ where }: { where: { referenceId?: string } }) => where.referenceId
      ? [{ key: "CAMPUS_ALIAS" }] : [{ reference: { id: campusId, kind: "CAMPUS", code: "CAMPUS_CODE", label: "Campus synthétique", state: "ACTIVE" } }] },
    lead: { updateMany: async () => ({ count: 1 }) },
    leadActivity: { create: async () => ({}) },
    auditEvent: { create: async ({ data }: { data: Prisma.AuditEventUncheckedCreateInput }) => { audits.push(data); return data; } },
    leadMutationReceipt: { create: async () => ({}) },
    localOutboxEvent: { create: async () => ({}) },
  } as unknown as Prisma.TransactionClient;
  const lead = { id: leadId, campus: "CAMPUS_CODE", version: 1, status: "PROSPECT" } as Lead;
  const request: ReassignmentRequest = { id: "00000000-0000-4000-8000-000000000096", leadId, currentOwnerId: "owner", targetUserId: "target",
    reason: "Motif synthétique", moveOpenTasks: false, requestedBy: "requester", status: "PENDING", requestedAt: new Date().toISOString(), version: 1 };
  await appendReassignmentEffect(tx, lead, request, { userId: "requester", roles: ["ADMISSIONS"], scopes: [{ kind: "CAMPUS", id: campusId }], sessionId: "session" },
    "synthetic-correlation", "reassignment-request:synthetic-audit", "synthetic-fingerprint", "REASSIGNMENT_REQUEST");
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.campusId, campusId);
  const projected = auditView({ ...audits[0], id: "00000000-0000-4000-8000-000000000097", occurredAt: new Date(), before: null } as AuditEvent);
  assert.equal(projected.campusId, campusId);
});
