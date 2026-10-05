import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { INestApplication } from "@nestjs/common";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { AuditEvent, Lead, LeadActivity, LeadMutationReceipt, LeadFollowUp, InternalNotification, LocalOutboxEvent, ReassignmentRequest as StoredRequest } from "@prisma/client";
import { createApplication } from "../src/application.js";
import type { Principal } from "../src/auth/auth.types.js";
import type { CreateLeadResult, LeadRecord } from "../src/leads/lead.service.js";
import type { CreateReassignmentInput, ReassignmentRequest } from "../src/assignment/reassignment.service.js";
import { DynamicPermissionService } from "../src/permissions/dynamic-service.js";
import { FollowUpService } from "../src/follow-up/follow-up.service.js";
import { referenceKey } from "../src/references/reference.contract.js";
import { assignmentFlowFixture, type AssignmentActor, type AssignmentFixture } from "./fixtures/assignment-flow-fixture.js";

const options = { skip: process.env.CRMY94_EPHEMERAL_TEST !== "true", timeout: 120_000 };
type Session = { token: string; sessionId: string; mustChangeSecret: boolean };
type Result<T> = { status: number; body: T };
type Candidate = { userId: string; active: boolean; capacity: number; activeLeadCount: number; suspended?: boolean; excluded?: boolean };
interface Journey extends AssignmentFixture {
  apps: INestApplication[];
  http<T = { code?: string }>(method: string, path: string, token?: string, body?: unknown, instance?: number): Promise<Result<T>>;
  commercialSession: Session; targetSession: Session; managerSession: Session; adminSession: Session;
  readerSession: Session; outsiderSession: Session; otherManagerSession: Session; firstLoginSession: Session;
  configure(strategy: "CONTROLLED_RANDOM" | "ROUND_ROBIN", candidates: Candidate[], automaticEnabled?: boolean, rules?: unknown[]): Promise<number>;
  close(): Promise<void>;
}
interface Effects {
  lead: Lead | null; activities: LeadActivity[]; audits: AuditEvent[]; receipts: LeadMutationReceipt[];
  requests: StoredRequest[]; reminders: LeadFollowUp[]; notifications: InternalNotification[]; outbox: LocalOutboxEvent[];
}

async function journey(): Promise<Journey> {
  const f = await assignmentFlowFixture();
  const apps: INestApplication[] = [];
  try {
    for (let index = 0; index < 2; index++) {
      const app = await createApplication(); apps.push(app); await app.listen(0, "127.0.0.1");
    }
    const endpoints = apps.map((app) => `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`);
    const http = async <T = { code?: string }>(method: string, path: string, token?: string, body?: unknown, instance = 0): Promise<Result<T>> => {
      const response = await fetch(`${endpoints[instance]}${path}`, { method, signal: AbortSignal.timeout(20_000), headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "x-correlation-id": f.key("http"), ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() as T };
    };
    const login = async (actor: AssignmentActor, instance: number): Promise<Session> => {
      const response = await http<Session>("POST", "/sessions", undefined, { email: actor.email, password: actor.password }, instance);
      assert.equal(response.status, 201); return response.body;
    };
    // Respect the actual five-attempt per-instance limiter; no test bypass.
    const commercial = await login(f.commercial, 0), target = await login(f.target, 0), manager = await login(f.manager, 0), admin = await login(f.admin, 0);
    const reader = await login(f.reader, 1), outsider = await login(f.outsider, 1), otherManager = await login(f.otherManager, 1), firstLogin = await login(f.firstLogin, 1);
    const configure = async (strategy: "CONTROLLED_RANDOM" | "ROUND_ROBIN", candidates: Candidate[], automaticEnabled = true, rules?: unknown[]): Promise<number> => {
      const previous = await http<{ version: number }>("GET", `/assignment/config?campusId=${f.campus.id}`, admin.token);
      assert.equal(previous.status, 200);
      const response = await http<{ version: number }>("PUT", "/assignment/config", admin.token, { campusId: f.campus.id, expectedVersion: previous.body.version, automaticEnabled,
        rules: rules ?? [{ id: f.key("fallback"), scope: "GLOBAL", strategy, enabled: true, candidates }] });
      assert.equal(response.status, 200); return response.body.version;
    };
    const close = async (): Promise<void> => {
      for (const app of apps) { (app.getHttpServer() as Server).closeAllConnections(); await app.close(); }
      await f.prisma.onModuleDestroy();
    };
    return { ...f, apps, http, commercialSession: commercial, targetSession: target, managerSession: manager, adminSession: admin, readerSession: reader, outsiderSession: outsider, otherManagerSession: otherManager, firstLoginSession: firstLogin, configure, close };
  } catch (error) {
    for (const app of apps) { (app.getHttpServer() as Server).closeAllConnections(); await app.close(); }
    await f.prisma.onModuleDestroy(); throw error;
  }
}
const candidate = (userId: string, capacity = 100): Candidate => ({ userId, active: true, capacity, activeLeadCount: 0 });
const requestInput = (f: AssignmentFixture, label: string, moveOpenTasks = false): CreateReassignmentInput => ({ targetUserId: f.target.id, reason: "Synthetic motivated reassignment", moveOpenTasks, idempotencyKey: f.key(label) });
const decisionInput = { approved: true, reason: "Synthetic distinct Manager approval" };

async function effects(f: AssignmentFixture, leadId: string): Promise<Effects> {
  return {
    lead: await f.db.lead.findUnique({ where: { id: leadId } }),
    activities: await f.db.leadActivity.findMany({ where: { leadId }, orderBy: { id: "asc" } }),
    audits: await f.db.auditEvent.findMany({ where: { resourceId: leadId }, orderBy: { id: "asc" } }),
    receipts: await f.db.leadMutationReceipt.findMany({ where: { leadId }, orderBy: { idempotencyKey: "asc" } }),
    requests: await f.db.reassignmentRequest.findMany({ where: { leadId }, orderBy: { id: "asc" } }),
    reminders: await f.db.leadFollowUp.findMany({ where: { leadId }, orderBy: { id: "asc" } }),
    notifications: await f.db.internalNotification.findMany({ where: { resourceId: leadId }, orderBy: { id: "asc" } }),
    outbox: await f.db.localOutboxEvent.findMany({ where: { aggregateId: leadId }, orderBy: { id: "asc" } }),
  };
}

async function denyAudit<T>(f: AssignmentFixture, eventType: "LEAD_CREATED" | "LEAD_REASSIGNMENT_REQUESTED" | "LEAD_REASSIGNMENT_APPROVED", operation: () => Promise<T>): Promise<T> {
  // Static allowlist plus an internally generated hexadecimal identifier. The
  // nonce fixture guard has already proved ownership before any DDL is possible.
  const name = `crmy94_fault_${f.suffix.toLowerCase()}`;
  assert.match(name, /^crmy94_fault_[0-9a-f]{8}$/u);
  assert.match(f.campus.code, /^ASG-CAMPUS-[A-F0-9]{8}$/u);
  assert.match(f.campus.id, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu);
  assert.ok(["LEAD_CREATED", "LEAD_REASSIGNMENT_REQUESTED", "LEAD_REASSIGNMENT_APPROVED"].includes(eventType));
  await f.db.$executeRawUnsafe(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type = '${eventType}' AND NEW.campus_id IN ('${f.campus.code}', '${f.campus.id}') THEN RAISE EXCEPTION 'synthetic_assignment_audit_failure'; END IF; RETURN NEW; END; $$`);
  try {
    await f.db.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    try { return await operation(); }
    finally { await f.db.$executeRawUnsafe(`DROP TRIGGER ${name} ON audit_events`); }
  } finally { await f.db.$executeRawUnsafe(`DROP FUNCTION ${name}()`); }
}

async function setGrant(f: Journey, role: "ADMISSIONS" | "MANAGER", key: "lead.view" | "lead.create" | "lead.edit" | "reminder.manage" | "lead.reassign.approve", value: "NONE" | "CAMPUS" | "OWN"): Promise<void> {
  const permissions = f.apps[0]!.get(DynamicPermissionService);
  const principal: Principal = { userId: f.admin.id, roles: ["SUPER_ADMIN"], scopes: [{ kind: "GLOBAL" }], sessionId: f.adminSession.sessionId };
  const target = { kind: "ROLE" as const, role, campus: f.campus.id };
  const previous = await permissions.read(principal, target);
  await permissions.save(principal, { ...target, expectedVersion: previous.version, grants: { ...previous.grants, [key]: value }, confirmed: true, reason: "ACCESS_REVIEW" });
}

test("CRMY-94 initial creation atomically records assignment, durable replay, eligibility, rules and rollback", options, async () => {
  const f = await journey();
  try {
    const configured = await f.configure("CONTROLLED_RANDOM", [candidate(f.commercial.id), candidate(f.target.id)]);
    const input = f.leadInput("initial");
    const created = await f.http<CreateLeadResult>("POST", "/leads", f.commercialSession.token, input);
    assert.equal(created.status, 201); assert.ok([f.commercial.id, f.target.id].includes(created.body.lead.assignedToId!));
    assert.equal(created.body.assignment?.outcome, "ASSIGNED"); assert.equal(created.body.assignment.configurationVersion, configured);
    const first = await effects(f, created.body.lead.id);
    assert.equal(first.activities.filter((row) => row.type === "LEAD_CREATED").length, 1);
    assert.equal(first.activities.filter((row) => row.type === "ASSIGNMENT_CHANGED").length, 1);
    assert.equal(first.audits.filter((row) => row.eventType === "LEAD_CREATED").length, 1);
    assert.equal(first.audits.filter((row) => row.eventType === "LEAD_ASSIGNED").length, 1);
    assert.equal(first.receipts.length, 1); assert.equal(first.outbox.length, 1);
    assert.equal(first.notifications.length, 1); assert.equal(first.notifications[0]?.type, "ASSIGNMENT"); assert.equal(first.notifications[0]?.recipientId, created.body.lead.assignedToId);
    assert.equal(first.notifications[0]?.href, `/leads/${created.body.lead.id}`);
    const replay = await f.http<CreateLeadResult>("POST", "/leads", f.commercialSession.token, input, 1);
    assert.equal(replay.status, 201); assert.deepEqual(replay.body, created.body); assert.deepEqual(await effects(f, created.body.lead.id), first);
    assert.equal((await f.http("POST", "/leads", f.commercialSession.token, { ...input, lastName: "Changed intention" }, 1)).status, 409);
    for (const token of [f.readerSession.token, f.firstLoginSession.token, f.outsiderSession.token]) {
      const refused = await f.http("POST", "/leads", token, input, 1);
      assert.equal(refused.status, 403, "The actual role, activation and canonical campus gate a known creation key");
    }
    const persisted = await f.http<LeadRecord>("GET", `/leads/${created.body.lead.id}`, f.adminSession.token, undefined, 1);
    assert.equal(persisted.status, 200); assert.equal(persisted.body.assignedToId, created.body.lead.assignedToId);
    const creatorRead = await f.http<LeadRecord>("GET", `/leads/${created.body.lead.id}`, f.commercialSession.token, undefined, 1);
    assert.equal(creatorRead.status, 200, "The actual default lead.view CAMPUS contract allows a readable same-campus Lead regardless of its owner");
    assert.equal(creatorRead.body.assignedToId, created.body.lead.assignedToId);
    // A dedicated nonce-campus fixture exercises a real permission restriction,
    // rather than assuming the default read scope is OWN or changing the server.
    const ownReadFixture = await f.ownedLead("view-own");
    const foreignOwnerReadFixture = await f.ownedLead("view-other-owner");
    await f.db.lead.update({ where: { id: foreignOwnerReadFixture.id }, data: { assignedToId: f.target.id } });
    assert.equal((await f.http("GET", `/leads/${foreignOwnerReadFixture.id}`, f.commercialSession.token, undefined, 1)).status, 200);
    await setGrant(f, "ADMISSIONS", "lead.view", "OWN");
    assert.equal((await f.http("GET", `/leads/${ownReadFixture.id}`, f.commercialSession.token, undefined, 1)).status, 200);
    assert.equal((await f.http("GET", `/leads/${foreignOwnerReadFixture.id}`, f.commercialSession.token, undefined, 1)).status, 403);
    await setGrant(f, "ADMISSIONS", "lead.view", "CAMPUS");
    // No grant for manual assignment is manufactured for this automatic path.
    assert.equal((await f.http("POST", `/leads/${created.body.lead.id}/assignment`, f.commercialSession.token, { targetUserId: f.target.id, confirmed: true })).status, 403);
    await setGrant(f, "ADMISSIONS", "lead.create", "NONE");
    assert.equal((await f.http("POST", "/leads", f.commercialSession.token, input, 1)).status, 403, "Current grant must gate even an already committed replay");
    await setGrant(f, "ADMISSIONS", "lead.create", "CAMPUS");
    const alternateCode = f.key("alternate-campaign");
    const alternate = await f.db.crmReference.create({ data: { kind: "CAMPAIGN", code: alternateCode, label: "Synthetic alternate campaign", scope: "GLOBAL", scopeKey: "GLOBAL", keys: { create: { kind: "CAMPAIGN", scopeKey: "GLOBAL", key: referenceKey(alternateCode) } } } });
    const priorityVersion = await f.configure("CONTROLLED_RANDOM", [], true, [
      { id: f.key("campaign-rule"), scope: "CAMPAIGN", matchValue: f.campaign.code, strategy: "CONTROLLED_RANDOM", enabled: true, candidates: [candidate(f.secondTarget.id)] },
      { id: f.key("source-rule"), scope: "SOURCE", matchValue: "PHONE_CALL", strategy: "CONTROLLED_RANDOM", enabled: true, candidates: [candidate(f.target.id)] },
      { id: f.key("campus-rule"), scope: "GLOBAL", strategy: "CONTROLLED_RANDOM", enabled: true, candidates: [candidate(f.commercial.id)] },
    ]);
    for (const [label, campaign, source, ownerId] of [
      ["priority-campaign", f.campaign.code, "PHONE_CALL", f.secondTarget.id],
      ["priority-source", alternate.code, "PHONE_CALL", f.target.id],
      ["priority-campus", alternate.code, "WEB_FORM", f.commercial.id],
    ]) {
      const selected = await f.http<CreateLeadResult>("POST", "/leads", f.commercialSession.token, { ...f.leadInput(label!), campaign, source });
      assert.equal(selected.status, 201); assert.equal(selected.body.lead.assignedToId, ownerId); assert.equal(selected.body.assignment?.configurationVersion, priorityVersion);
    }
    const preserved = await f.http<CreateLeadResult>("POST", "/leads", f.commercialSession.token, input, 1);
    assert.equal(preserved.status, 201); assert.equal(preserved.body.assignment?.configurationVersion, configured); assert.equal(preserved.body.lead.assignedToId, created.body.lead.assignedToId);
    const foreignRule = await f.http("PUT", "/assignment/config", f.adminSession.token, { campusId: f.campus.id, expectedVersion: priorityVersion, automaticEnabled: true, rules: [{ id: f.key("foreign-rule"), scope: "GLOBAL", strategy: "CONTROLLED_RANDOM", enabled: true, candidates: [candidate(f.outsider.id)] }] });
    assert.equal(foreignRule.status, 403);
    await f.configure("CONTROLLED_RANDOM", [candidate(f.firstLogin.id), candidate(f.manager.id), candidate(f.target.id), candidate(f.commercial.id)]);
    await f.db.collaborator.update({ where: { id: f.target.id }, data: { active: false } });
    const eligible = await f.http<CreateLeadResult>("POST", "/leads", f.commercialSession.token, f.leadInput("eligible"));
    assert.equal(eligible.status, 201); assert.equal(eligible.body.lead.assignedToId, f.commercial.id, "First-access, inactive and non-Commercial candidates are not operational recipients");
    await setGrant(f, "ADMISSIONS", "lead.edit", "NONE");
    const unassigned = await f.http<CreateLeadResult>("POST", "/leads", f.commercialSession.token, f.leadInput("denied-target"));
    assert.equal(unassigned.status, 201); assert.equal(unassigned.body.lead.assignedToId, undefined); assert.equal(unassigned.body.assignment?.reason, "assignment_candidate_unavailable");
    const unassignedNotifications = await f.db.internalNotification.findMany({ where: { resourceId: unassigned.body.lead.id } });
    for (const id of [f.manager.id, f.otherManager.id, f.admin.id]) assert.ok(unassignedNotifications.some((row) => row.recipientId === id && row.type === "ASSIGNMENT"));
    for (const row of unassignedNotifications) assert.equal(row.href, `/leads/${unassigned.body.lead.id}/collaborators`);
    for (const id of [f.outsider.id, f.reader.id, f.firstLogin.id]) assert.equal(unassignedNotifications.some((row) => row.recipientId === id), false);
    await setGrant(f, "ADMISSIONS", "lead.edit", "OWN");
    await f.configure("ROUND_ROBIN", [candidate(f.commercial.id)], false);
    const disabled = await f.http<CreateLeadResult>("POST", "/leads", f.commercialSession.token, f.leadInput("disabled"));
    assert.equal(disabled.status, 201); assert.equal(disabled.body.assignment?.reason, "assignment_automation_disabled"); assert.equal(disabled.body.lead.assignedToId, undefined);
    await f.configure("ROUND_ROBIN", [candidate(f.commercial.id)]);
    const before = await Promise.all([f.db.lead.count(), f.db.leadActivity.count(), f.db.auditEvent.count({ where: { eventType: { in: ["LEAD_CREATED", "LEAD_ASSIGNED"] } } }), f.db.leadMutationReceipt.count(), f.db.campusAssignmentCursor.findMany({ where: { campusId: f.campus.id } }), f.db.localOutboxEvent.count(), f.db.internalNotification.count()]);
    const failed = await denyAudit(f, "LEAD_CREATED", () => f.http("POST", "/leads", f.commercialSession.token, f.leadInput("audit-fault")));
    assert.ok(failed.status >= 400);
    const after = await Promise.all([f.db.lead.count(), f.db.leadActivity.count(), f.db.auditEvent.count({ where: { eventType: { in: ["LEAD_CREATED", "LEAD_ASSIGNED"] } } }), f.db.leadMutationReceipt.count(), f.db.campusAssignmentCursor.findMany({ where: { campusId: f.campus.id } }), f.db.localOutboxEvent.count(), f.db.internalNotification.count()]);
    assert.deepEqual(after, before, "A genuine PostgreSQL audit refusal rolls back Lead, assignment, cursor, receipt and outbox");
    assert.equal((await f.http("POST", "/leads", f.commercialSession.token, f.leadInput("audit-fault"), 1)).status, 201);
    assert.equal(await f.db.sheetImportConnector.count({ where: { enabled: true } }), 0);
    assert.equal(await f.db.telephonyAgentCommand.count(), 0);
    await f.db.localSession.update({ where: { id: f.commercialSession.sessionId }, data: { active: false } });
    assert.equal((await f.http("POST", "/leads", f.commercialSession.token, input, 1)).status, 401);
  } finally { await f.close(); }
});

test("CRMY-94 two API producers respect durable creation replay and real capacity without a second draw", options, async () => {
  const f = await journey();
  try {
    const version = await f.configure("ROUND_ROBIN", [candidate(f.commercial.id, 1)]);
    const input = f.leadInput("concurrent-identical");
    const races = await Promise.all([f.http<CreateLeadResult>("POST", "/leads", f.commercialSession.token, input), f.http<CreateLeadResult>("POST", "/leads", f.commercialSession.token, input, 1)]);
    assert.ok(races.some((row) => row.status === 201)); assert.ok(races.every((row) => [201, 409].includes(row.status)));
    const winner = races.find((row) => row.status === 201)!;
    const confirmed = await f.http<CreateLeadResult>("POST", "/leads", f.commercialSession.token, input, 1);
    assert.equal(confirmed.status, 201); assert.equal(confirmed.body.lead.id, winner.body.lead.id);
    assert.equal(confirmed.body.lead.assignedToId, f.commercial.id);
    assert.equal(await f.db.lead.count({ where: { email: input.email } }), 1);
    assert.equal((await f.db.campusAssignmentCursor.findUniqueOrThrow({ where: { campusId_version_ruleId: { campusId: f.campus.id, version, ruleId: f.key("fallback") } } })).cursor, 1);
    const capacityVersion = await f.configure("ROUND_ROBIN", [candidate(f.commercial.id, 2)]);
    const capacities = await Promise.all([f.http<CreateLeadResult>("POST", "/leads", f.commercialSession.token, f.leadInput("capacity-a")), f.http<CreateLeadResult>("POST", "/leads", f.commercialSession.token, f.leadInput("capacity-b"), 1)]);
    assert.ok(capacities.every((row) => [201, 409].includes(row.status)));
    assert.equal(capacities.filter((row) => row.status === 201 && row.body.assignment?.outcome === "ASSIGNED").length, 1, "Exactly one of two producers can consume the final available place");
    for (const row of capacities.filter((value) => value.status === 201 && value.body.assignment?.outcome === "UNASSIGNED")) assert.equal(row.body.assignment?.reason, "assignment_candidate_unavailable");
    assert.equal(await f.db.lead.count({ where: { assignedToId: f.commercial.id, status: { notIn: ["ENROLLED", "CLOSED_LOST"] } } }), 2, "Capacity comes from committed PostgreSQL ownership across both producers");
    assert.equal((await f.db.campusAssignmentCursor.findUniqueOrThrow({ where: { campusId_version_ruleId: { campusId: f.campus.id, version: capacityVersion, ruleId: f.key("fallback") } } })).cursor, 1);
    const original = await effects(f, winner.body.lead.id);
    assert.equal(original.receipts.length, 1); assert.equal(original.audits.filter((row) => row.eventType === "LEAD_ASSIGNED").length, 1);
  } finally { await f.close(); }
});

test("CRMY-94 authenticated request and distinct decision bind exact intention, preserve history and roll back together", options, async () => {
  const f = await journey();
  try {
    await f.configure("CONTROLLED_RANDOM", [candidate(f.commercial.id), candidate(f.target.id), candidate(f.secondTarget.id)]);
    const lead = await f.ownedLead("request"); const other = await f.ownedLead("other-request");
    const retainedReminder = await f.db.leadFollowUp.create({ data: { leadId: lead.id, ownerId: f.commercial.id, dueAt: new Date(Date.now() + 3_600_000), state: "SCHEDULED", reason: "Synthetic explicit no-transfer", idempotencyKey: f.key("no-transfer"), fingerprint: "d".repeat(64) } });
    const input = requestInput(f, "request");
    const original = await effects(f, lead.id);
    const failed = await denyAudit(f, "LEAD_REASSIGNMENT_REQUESTED", () => f.http("POST", `/leads/${lead.id}/reassignment-requests`, f.commercialSession.token, input));
    assert.ok(failed.status >= 400); assert.deepEqual(await effects(f, lead.id), original);
    const simultaneous = await Promise.all([f.http<ReassignmentRequest>("POST", `/leads/${lead.id}/reassignment-requests`, f.commercialSession.token, input), f.http<ReassignmentRequest>("POST", `/leads/${lead.id}/reassignment-requests`, f.commercialSession.token, input, 1)]);
    assert.ok(simultaneous.some((row) => row.status === 201)); assert.ok(simultaneous.every((row) => [201, 409].includes(row.status)));
    const requested = simultaneous.find((row) => row.status === 201)!;
    assert.equal(requested.status, 201); assert.equal(requested.body.status, "PENDING");
    const pending = await effects(f, lead.id); assert.equal(pending.lead?.assignedToId, f.commercial.id); assert.equal(pending.requests.length, 1);
    for (const id of [f.manager.id, f.otherManager.id, f.admin.id]) assert.ok(pending.notifications.some((row) => row.recipientId === id && row.type === "ASSIGNMENT"));
    for (const row of pending.notifications) assert.equal(row.href, `/leads/${lead.id}/collaborators`);
    assert.equal(pending.notifications.some((row) => row.recipientId === f.commercial.id), false);
    const replay = await f.http<ReassignmentRequest>("POST", `/leads/${lead.id}/reassignment-requests`, f.commercialSession.token, { ...input, reason: ` ${input.reason} ` });
    assert.equal(replay.status, 201); assert.equal(replay.body.id, requested.body.id); assert.deepEqual(await effects(f, lead.id), pending);
    for (const patch of [{ reason: "Changed justified intention" }, { targetUserId: f.secondTarget.id }, { moveOpenTasks: true }]) {
      assert.equal((await f.http("POST", `/leads/${lead.id}/reassignment-requests`, f.commercialSession.token, { ...input, ...patch })).status, 409);
    }
    assert.equal((await f.http("POST", `/leads/${other.id}/reassignment-requests`, f.commercialSession.token, input)).status, 409);
    assert.equal((await f.http("POST", `/leads/${lead.id}/reassignment-requests`, f.managerSession.token, input)).status, 409);
    assert.ok([403, 404].includes((await f.http("POST", `/leads/${lead.id}/reassignment-requests`, f.outsiderSession.token, input)).status));
    assert.equal((await f.http("POST", `/leads/${lead.id}/reassignment-requests`, f.firstLoginSession.token, input)).status, 403);
    assert.deepEqual(await effects(f, lead.id), pending, "Every collision and refusal has zero persisted effects");
    const selfLead = await f.ownedLead("self-manager");
    const selfRequest = await f.http<ReassignmentRequest>("POST", `/leads/${selfLead.id}/reassignment-requests`, f.managerSession.token, requestInput(f, "self"));
    assert.equal(selfRequest.status, 201);
    // Bounded paging-only fixtures: old foreign requests must be excluded before
    // take(100). These direct fixture writes are not evidence of the HTTP path.
    const foreignTarget = await f.db.collaborator.create({ data: { professionalEmail: `foreign-target-${f.suffix.toLowerCase()}@example.invalid`, roles: ["ADMISSIONS"], campusId: f.otherCampus.id, active: true, firstLoginRequired: false } });
    const foreignLeads = Array.from({ length: 100 }, (_, index) => ({ id: randomUUID(), leadCode: `ASG-${f.suffix}-F${String(index).padStart(3, "0")}`, firstName: "Synthetic", lastName: "Foreign paging fixture", campus: f.otherCampus.code, campaign: f.campaign.code, program: f.program.code, educationLevel: "BAC", source: "PHONE_CALL", assignedToId: f.outsider.id }));
    await f.db.lead.createMany({ data: foreignLeads });
    await f.db.reassignmentRequest.createMany({ data: foreignLeads.map((foreignLead, index) => ({ leadId: foreignLead.id, currentOwnerId: f.outsider.id, targetUserId: foreignTarget.id, requestedBy: f.outsider.id, reason: "Synthetic foreign paging fixture", moveOpenTasks: false, status: "PENDING", requestedAt: new Date(Date.now() - 600_000 - index), idempotencyKey: f.key(`foreign-paging-${index}`) })) });
    const inbox = await f.http<{ requests: ReassignmentRequest[]; code?: string }>("GET", "/reassignment-requests", f.managerSession.token, undefined, 1);
    assert.equal(inbox.status, 200, JSON.stringify({ status: inbox.status, code: inbox.body.code })); assert.equal(inbox.body.requests.find((row) => row.id === requested.body.id)?.canDecide, true);
    assert.equal(inbox.body.requests.find((row) => row.id === selfRequest.body.id)?.canDecide, false);
    const foreignLeadIds = new Set<string>(foreignLeads.map((row) => row.id));
    assert.equal(inbox.body.requests.some((row) => foreignLeadIds.has(row.leadId)), false, "Foreign campus requests cannot crowd or leak into the Manager inbox");
    assert.equal((await f.http("PATCH", `/reassignment-requests/${selfRequest.body.id}/decision`, f.managerSession.token, decisionInput)).status, 403);
    assert.equal((await f.http("PATCH", `/reassignment-requests/${requested.body.id}/decision`, f.readerSession.token, decisionInput)).status, 403);
    const failedDecision = await denyAudit(f, "LEAD_REASSIGNMENT_APPROVED", () => f.http("PATCH", `/reassignment-requests/${requested.body.id}/decision`, f.managerSession.token, decisionInput));
    assert.ok(failedDecision.status >= 400); assert.deepEqual(await effects(f, lead.id), pending);
    const accepted = await f.http<{ request: ReassignmentRequest; lead: LeadRecord }>("PATCH", `/reassignment-requests/${requested.body.id}/decision`, f.managerSession.token, decisionInput, 1);
    assert.equal(accepted.status, 200); assert.equal(accepted.body.request.status, "APPROVED"); assert.equal(accepted.body.lead.assignedToId, f.target.id);
    const terminal = await effects(f, lead.id); assert.equal(terminal.requests[0]?.version, 2);
    assert.equal(terminal.audits.filter((row) => row.eventType === "LEAD_REASSIGNMENT_APPROVED").length, 1);
    assert.equal(terminal.activities.filter((row) => row.type === "ASSIGNMENT_CHANGED").length, 1);
    assert.equal(terminal.receipts.filter((row) => row.operation === "REASSIGNMENT_DECISION").length, 1);
    assert.deepEqual(terminal.notifications.filter((row) => row.type === "REASSIGNMENT_DECISION").map((row) => row.recipientId).sort(), [f.commercial.id, f.target.id].sort());
    for (const row of terminal.notifications.filter((item) => item.type === "REASSIGNMENT_DECISION")) assert.equal(row.href, `/leads/${lead.id}/collaborators`);
    assert.deepEqual(await f.db.leadFollowUp.findUniqueOrThrow({ where: { id: retainedReminder.id } }), retainedReminder, "Explicit false never transfers an open reminder");
    const again = await f.http<{ request: ReassignmentRequest }>("PATCH", `/reassignment-requests/${requested.body.id}/decision`, f.managerSession.token, decisionInput);
    assert.equal(again.status, 200); assert.equal(again.body.request.id, requested.body.id); assert.deepEqual(await effects(f, lead.id), terminal);
    assert.equal((await f.http("PATCH", `/reassignment-requests/${requested.body.id}/decision`, f.managerSession.token, { ...decisionInput, reason: "Another decision motivation" })).status, 409);
    assert.equal((await f.http("PATCH", `/reassignment-requests/${requested.body.id}/decision`, f.otherManagerSession.token, decisionInput)).status, 409);
    const competingLead = await f.ownedLead("competing-decision");
    const competingRequest = await f.http<ReassignmentRequest>("POST", `/leads/${competingLead.id}/reassignment-requests`, f.commercialSession.token, requestInput(f, "competing-decision"));
    assert.equal(competingRequest.status, 201);
    const rejection = { approved: false, reason: "Synthetic separate rejection" };
    const decisions = await Promise.all([f.http("PATCH", `/reassignment-requests/${competingRequest.body.id}/decision`, f.managerSession.token, decisionInput), f.http("PATCH", `/reassignment-requests/${competingRequest.body.id}/decision`, f.otherManagerSession.token, rejection, 1)]);
    assert.deepEqual(decisions.map((row) => row.status).sort(), [200, 409]);
    const competingFinal = await effects(f, competingLead.id);
    assert.equal(competingFinal.requests[0]?.version, 2);
    assert.equal(competingFinal.audits.filter((row) => ["LEAD_REASSIGNMENT_APPROVED", "LEAD_REASSIGNMENT_REJECTED"].includes(row.eventType)).length, 1);
    assert.equal(competingFinal.receipts.filter((row) => row.operation === "REASSIGNMENT_DECISION").length, 1);
    assert.equal(competingFinal.lead?.assignedToId, competingFinal.requests[0]?.status === "APPROVED" ? f.target.id : f.commercial.id);
    await setGrant(f, "MANAGER", "lead.reassign.approve", "NONE");
    assert.equal((await f.http("PATCH", `/reassignment-requests/${requested.body.id}/decision`, f.managerSession.token, decisionInput, 1)).status, 403);
    assert.deepEqual(await effects(f, lead.id), terminal, "Revoked permissions reject even a successful historical decision replay");
    assert.equal((await f.http<LeadRecord>("GET", `/leads/${lead.id}`, f.targetSession.token, undefined, 1)).body.assignedToId, f.target.id);
  } finally { await f.close(); }
});

test("CRMY-94 optional transfer changes only scheduled reminder ownership/version, not authors or unrelated responsibilities", options, async () => {
  const f = await journey();
  try {
    await f.configure("CONTROLLED_RANDOM", [candidate(f.commercial.id), candidate(f.target.id)]);
    const lead = await f.ownedLead("transfer");
    const dueAt = new Date(Date.now() + 3_600_000);
    const reminders = await Promise.all((["SCHEDULED", "DUE", "COMPLETED", "CANCELLED"] as const).map((state) => f.db.leadFollowUp.create({ data: { leadId: lead.id, ownerId: f.commercial.id, dueAt, state, reason: `Synthetic ${state}`, idempotencyKey: f.key(state), fingerprint: "a".repeat(64) } })));
    const foreign = await f.db.leadFollowUp.create({ data: { leadId: lead.id, ownerId: f.manager.id, dueAt, state: "SCHEDULED", reason: "Synthetic another owner", idempotencyKey: f.key("foreign-reminder"), fingerprint: "b".repeat(64) } });
    const historical = await f.db.leadActivity.create({ data: { leadId: lead.id, type: "COMMENT", result: "SYNTHETIC_HISTORICAL_AUTHOR", authorId: f.commercial.id, correlationId: f.key("history"), idempotencyKey: f.key("history") } });
    const protectedCounts = await Promise.all([f.db.admissionsBooking.count(), f.db.appointment.count(), f.db.telephonyCall.count(), f.db.telephonyAgentCommand.count()]);
    const request = await f.http<ReassignmentRequest>("POST", `/leads/${lead.id}/reassignment-requests`, f.commercialSession.token, requestInput(f, "transfer", true));
    assert.equal(request.status, 201);
    const pending = await effects(f, lead.id);
    const fault = await denyAudit(f, "LEAD_REASSIGNMENT_APPROVED", () => f.http("PATCH", `/reassignment-requests/${request.body.id}/decision`, f.managerSession.token, decisionInput));
    assert.ok(fault.status >= 400); assert.deepEqual(await effects(f, lead.id), pending, "The genuine audit refusal rolls back transferred reminder owner/version and its audit, as well as the decision effects");
    const decided = await f.http("PATCH", `/reassignment-requests/${request.body.id}/decision`, f.managerSession.token, decisionInput);
    assert.equal(decided.status, 200);
    const scheduled = await f.db.leadFollowUp.findUniqueOrThrow({ where: { id: reminders[0]!.id } });
    assert.equal(scheduled.ownerId, f.target.id); assert.equal(scheduled.version, 2); assert.equal(scheduled.state, "SCHEDULED");
    assert.equal(scheduled.reason, reminders[0]!.reason); assert.deepEqual(scheduled.dueAt, reminders[0]!.dueAt); assert.deepEqual(scheduled.createdAt, reminders[0]!.createdAt);
    for (const untouched of [...reminders.slice(1), foreign]) assert.deepEqual(await f.db.leadFollowUp.findUniqueOrThrow({ where: { id: untouched.id } }), untouched);
    assert.deepEqual(await f.db.leadActivity.findUniqueOrThrow({ where: { id: historical.id } }), historical, "Transfer never rewrites the historical author");
    assert.deepEqual(await Promise.all([f.db.admissionsBooking.count(), f.db.appointment.count(), f.db.telephonyCall.count(), f.db.telephonyAgentCommand.count()]), protectedCounts);
    assert.equal(await f.db.internalNotification.count({ where: { resourceId: lead.id, type: "FOLLOW_UP_DUE" } }), 0, "A transfer itself does not fabricate an elapsed reminder notification");
    const terminal = await effects(f, lead.id);
    assert.equal((await f.http("PATCH", `/reassignment-requests/${request.body.id}/decision`, f.managerSession.token, decisionInput, 1)).status, 200);
    assert.deepEqual(await effects(f, lead.id), terminal);
    const stale = await f.http("PATCH", `/follow-ups/${scheduled.id}`, f.commercialSession.token, { action: "COMPLETE", reason: "Synthetic obsolete owner", expectedVersion: 1, idempotencyKey: f.key("stale-complete") });
    assert.ok([403, 409].includes(stale.status));
    await setGrant(f, "ADMISSIONS", "reminder.manage", "NONE");
    const blockedLead = await f.ownedLead("blocked-transfer");
    assert.equal((await f.http("POST", `/leads/${blockedLead.id}/reassignment-requests`, f.commercialSession.token, requestInput(f, "blocked-transfer", true))).status, 409, "A selected target must retain the capability to manage the transferred reminder");
  } finally { await f.close(); }
});

test("CRMY-94 real reminder due/complete races never transfer terminal rows or duplicate a due notification", options, async () => {
  const f = await journey();
  try {
    await f.configure("CONTROLLED_RANDOM", [candidate(f.commercial.id), candidate(f.target.id)]);
    for (const race of ["due", "complete"] as const) {
      const lead = await f.ownedLead(`race-${race}`);
      const item = await f.db.leadFollowUp.create({ data: { leadId: lead.id, ownerId: f.commercial.id, dueAt: new Date(Date.now() + 60_000), state: "SCHEDULED", reason: "Synthetic race", idempotencyKey: f.key(`reminder-${race}`), fingerprint: "c".repeat(64) } });
      const request = await f.http<ReassignmentRequest>("POST", `/leads/${lead.id}/reassignment-requests`, f.commercialSession.token, requestInput(f, `race-${race}`, true));
      assert.equal(request.status, 201);
      const raceOperation = race === "due"
        ? f.apps[1]!.get(FollowUpService).notifyDueForApi(new Date(Date.now() + 120_000))
        : f.http("PATCH", `/follow-ups/${item.id}`, f.commercialSession.token, { action: "COMPLETE", reason: "Synthetic completion race", expectedVersion: 1, idempotencyKey: f.key("race-complete") }, 1);
      const results = await Promise.allSettled([f.http("PATCH", `/reassignment-requests/${request.body.id}/decision`, f.managerSession.token, decisionInput), raceOperation]);
      assert.equal(results[0]?.status, "fulfilled");
      const decision = results[0] as PromiseFulfilledResult<Result<{ code?: string }>>;
      assert.ok([200, 409].includes(decision.value.status));
      if (decision.value.status === 409) assert.equal((await f.http("PATCH", `/reassignment-requests/${request.body.id}/decision`, f.managerSession.token, decisionInput)).status, 200);
      if (race === "due") {
        // A Serializable loser may be retried as a scheduler tick. This is not a
        // retry of a telephone command or a fabricated delivered notification.
        await f.apps[1]!.get(FollowUpService).notifyDueForApi(new Date(Date.now() + 120_000));
        const current = await f.db.leadFollowUp.findUniqueOrThrow({ where: { id: item.id } });
        assert.equal(current.state, "DUE"); assert.ok([f.commercial.id, f.target.id].includes(current.ownerId));
        const notifications = await f.db.internalNotification.findMany({ where: { resourceId: lead.id, type: "FOLLOW_UP_DUE" } });
        assert.equal(notifications.length, 1); assert.equal(notifications[0]!.recipientId, current.ownerId);
        assert.equal(await f.db.auditEvent.count({ where: { resourceId: lead.id, eventType: "FOLLOW_UP_DUE" } }), 1);
      } else {
        assert.equal(results[1]?.status, "fulfilled");
        const current = await f.db.leadFollowUp.findUniqueOrThrow({ where: { id: item.id } });
        assert.ok(["SCHEDULED", "COMPLETED"].includes(current.state));
        assert.equal(current.ownerId, current.state === "COMPLETED" ? f.commercial.id : f.target.id);
        assert.equal(current.version, 2, "Exactly one winning state/ownership mutation increments the reminder version");
      }
      assert.equal((await f.db.lead.findUniqueOrThrow({ where: { id: lead.id } })).assignedToId, f.target.id);
    }
  } finally { await f.close(); }
});
