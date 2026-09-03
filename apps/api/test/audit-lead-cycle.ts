import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import type { AuditEvent, Lead, LeadActivity, LeadCollaborationRequest, LeadCollaborator, LeadMutationReceipt, LocalOutboxEvent, PrismaClient } from "@prisma/client";

interface SyntheticAccount { id: string; email: string; password: string; campusId: string }
export interface LeadAuditFixture { accounts: [SyntheticAccount, SyntheticAccount, SyntheticAccount]; assignmentLeadId: string }
interface AdditionState {
  lead: Lead;
  collaborators: LeadCollaborator[];
  activities: LeadActivity[];
  receipts: LeadMutationReceipt[];
  audit: AuditEvent[];
  outbox: LocalOutboxEvent[];
  request: LeadCollaborationRequest;
}

/** Only called with the harness-owned tmpfs database; no supplied DATABASE_URL. */
export async function prepareLeadAuditFixture(client: PrismaClient): Promise<LeadAuditFixture> {
  async function reference(kind: "CAMPUS" | "PROGRAM" | "CAMPAIGN", code: string): Promise<string> {
    return (await client.crmReference.create({ data: { kind, scope: "GLOBAL", scopeKey: "GLOBAL", code, label: code, keys: { create: { kind, scopeKey: "GLOBAL", key: code, version: 1 } } } })).id;
  }
  const campusA = await reference("CAMPUS", "SYNTHETIC-A"), campusB = await reference("CAMPUS", "SYNTHETIC-B");
  const program = await reference("PROGRAM", "SYNTHETIC-PROGRAM"); await reference("CAMPAIGN", "SYNTHETIC-CAMPAIGN");
  await client.crmProgramAvailability.create({ data: { programId: program, campusId: campusA, active: true } });
  async function account(campusId: string): Promise<SyntheticAccount> {
    const id = randomUUID(), email = `${id}@example.invalid`, password = `Synt!9${randomBytes(24).toString("hex")}`;
    await client.collaborator.create({ data: { id, professionalEmail: email, roles: ["ADMIN"], campusId, firstLoginRequired: false } });
    // Same local seed storage contract; random credentials remain in this process only.
    const passwordSalt = randomBytes(16).toString("hex");
    await client.localPasswordHash.create({ data: { collaboratorId: id, identityDigest: createHash("sha256").update(email).digest("hex"), passwordSalt, passwordDigest: scryptSync(password, passwordSalt, 32).toString("hex"), mustChange: false } });
    return { id, email, password, campusId };
  }
  const accounts: LeadAuditFixture["accounts"] = [await account(campusA), await account(campusA), await account(campusB)];
  const lead = await client.lead.create({ data: { leadCode: "SYNTHETIC-ASSIGNMENT-GATE", firstName: "Lead", lastName: "Synthétique", campus: "SYNTHETIC-A", program: "SYNTHETIC-PROGRAM", campaign: "SYNTHETIC-CAMPAIGN", educationLevel: "BAC", source: "TEST" } });
  return { accounts, assignmentLeadId: lead.id };
}

export async function assertLeadAuditCycle(client: PrismaClient, base: string, fixture: LeadAuditFixture, report: (message: string) => void, additionRollbackOnly = false): Promise<void> {
  async function login(account: SyntheticAccount): Promise<{ id: string; token: string; sessionId: string }> {
    const response = await fetch(`${base}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: account.email, password: account.password }) });
    assert.equal(response.status, 201, "local login must succeed without printing credentials");
    const session = await response.json() as { token: string; sessionId: string };
    const user = await client.collaborator.findUniqueOrThrow({ where: { id: account.id } });
    assert.deepEqual(user.roles, ["ADMIN"]); assert.equal(user.campusId, account.campusId);
    assert.equal((await client.localSession.findUniqueOrThrow({ where: { id: session.sessionId } })).collaboratorId, account.id);
    return { id: account.id, ...session };
  }
  const actor = await login(fixture.accounts[0]), reviewer = await login(fixture.accounts[1]), outsider = await login(fixture.accounts[2]);
  async function request(path: string, method: string, body: unknown, correlation: string, user = actor): Promise<Response> {
    return fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${user.token}`, "content-type": "application/json", "x-correlation-id": correlation }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function success<T>(path: string, method: string, body: unknown, correlation: string, status: number, user = actor): Promise<T> {
    const response = await request(path, method, body, correlation, user);
    assert.equal(response.status, status, `${correlation}: expected authenticated success`);
    return response.json() as Promise<T>;
  }
  await success("/assignment/config", "PUT", { rules: [{ scope: "GLOBAL", strategy: "ROUND_ROBIN", enabled: true, candidates: [{ userId: actor.id, active: true, capacity: 20, activeLeadCount: 0 }] }] }, "cycle-config", 200);
  await success(`/leads/${fixture.assignmentLeadId}/assignment`, "POST", { targetUserId: actor.id, confirmed: true, idempotencyKey: "gate-assignment" }, "gate-assignment", 201);
  assert.equal((await client.lead.findUniqueOrThrow({ where: { id: fixture.assignmentLeadId } })).assignedToId, actor.id);
  const gateEvents = await client.auditEvent.findMany({ where: { resourceId: fixture.assignmentLeadId } });
  assert.equal(gateEvents.length, 1); assert.equal(gateEvents[0]?.actorId, actor.id); assert.equal(gateEvents[0]?.eventType, "LEAD_ASSIGNED");
  assert.equal(gateEvents[0]?.campusId, "SYNTHETIC-A"); assert.equal(gateEvents[0]?.sessionId, null);
  assert.deepEqual(gateEvents[0]?.after, { version: 2, scope: "CAMPUS" });
  report("Compiled API assignment gate: HTTP 201, one persistent audit, authenticated Admin and correct campus.");
  // A separate lead keeps this rollback/retry proof outside the seven-mutation count.
  const rollbackLeadId = fixture.assignmentLeadId;
  assert.equal(await client.leadCollaborator.count({ where: { leadId: rollbackLeadId, userId: reviewer.id } }), 0);
  const addition = await success<{ id: string }>(`/leads/${rollbackLeadId}/collaboration-requests`, "POST", { targetUserId: reviewer.id, action: "ADD", role: "ADVISER", justification: "Test ajout annulé synthétique" }, "addition-request", 201);
  async function additionState(): Promise<AdditionState> {
    return {
      lead: await client.lead.findUniqueOrThrow({ where: { id: rollbackLeadId } }),
      collaborators: await client.leadCollaborator.findMany({ where: { leadId: rollbackLeadId }, orderBy: { userId: "asc" } }),
      activities: await client.leadActivity.findMany({ where: { leadId: rollbackLeadId }, orderBy: { id: "asc" } }),
      receipts: await client.leadMutationReceipt.findMany({ where: { leadId: rollbackLeadId }, orderBy: { idempotencyKey: "asc" } }),
      audit: await client.auditEvent.findMany({ where: { resourceId: rollbackLeadId }, orderBy: { id: "asc" } }),
      outbox: await client.localOutboxEvent.findMany({ where: { aggregateId: rollbackLeadId }, orderBy: { id: "asc" } }),
      request: await client.leadCollaborationRequest.findUniqueOrThrow({ where: { id: addition.id } }),
    };
  }
  const beforeAddition = await additionState();
  await client.$executeRawUnsafe("CREATE FUNCTION crmy54_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.correlation_id = 'cycle-audit-failure' THEN RAISE EXCEPTION 'synthetic_audit_write_failure'; END IF; RETURN NEW; END $$");
  await client.$executeRawUnsafe("CREATE TRIGGER crmy54_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION crmy54_fail_audit()");
  try {
    const failed = await request(`/collaboration-requests/${addition.id}/decision`, "PATCH", { decision: "APPROVE", expectedVersion: 1, reason: "Échec ajout local contrôlé" }, "cycle-audit-failure", reviewer);
    assert.equal(failed.status, 503); assert.deepEqual(await failed.json(), { code: "permission_store_unavailable" });
    assert.deepEqual(await additionState(), beforeAddition, "failed audit must roll back addition, lead version, timeline, receipt, outbox and decision");
    assert.equal(await client.leadCollaborator.count({ where: { leadId: rollbackLeadId, userId: reviewer.id } }), 0);
    assert.equal(await client.auditEvent.count({ where: { correlationId: "cycle-audit-failure" } }), 0);
    report("Collaborator ADD audit failure: member still absent; lead/version, audit, receipt, timeline, outbox and pending request unchanged.");
  } finally {
    await client.$executeRawUnsafe("DROP TRIGGER crmy54_audit_failure ON audit_events");
    await client.$executeRawUnsafe("DROP FUNCTION crmy54_fail_audit()");
  }
  await success(`/collaboration-requests/${addition.id}/decision`, "PATCH", { decision: "APPROVE", expectedVersion: 1, reason: "Nouvelle tentative synthétique" }, "addition-retry", 200, reviewer);
  const afterAddition = await additionState();
  assert.equal(afterAddition.collaborators.length, 1);
  assert.equal(afterAddition.collaborators[0]?.userId, reviewer.id); assert.equal(afterAddition.collaborators[0]?.active, true);
  assert.equal(afterAddition.lead.version, beforeAddition.lead.version + 1);
  assert.equal(afterAddition.receipts.length, beforeAddition.receipts.length + 1);
  assert.equal(afterAddition.audit.length, beforeAddition.audit.length + 1);
  assert.equal(afterAddition.request.state, "APPROVED"); assert.equal(afterAddition.request.decidedBy, reviewer.id);
  const addedAudit = afterAddition.audit.filter((event) => !beforeAddition.audit.some((previous) => previous.id === event.id));
  assert.equal(addedAudit.length, 1);
  assert.equal(addedAudit[0]?.actorId, reviewer.id); assert.deepEqual(addedAudit[0]?.actorRoles, ["ADMIN"]);
  assert.equal(addedAudit[0]?.eventType, "COLLABORATION_DECIDED"); assert.equal(addedAudit[0]?.result, "SUCCESS");
  assert.equal(addedAudit[0]?.campusId, "SYNTHETIC-A"); assert.equal(addedAudit[0]?.resourceId, rollbackLeadId);
  assert.equal(addedAudit[0]?.resourceType, "LEAD"); assert.equal(addedAudit[0]?.correlationId, "addition-retry");
  assert.deepEqual(addedAudit[0]?.after, { version: afterAddition.lead.version, scope: "CAMPUS" });
  assert.equal(addedAudit[0]?.sessionId, null); assert.equal(addedAudit[0]?.minimizedIp, null);
  report("Normal authenticated ADD retry: one member, one success audit, correct reviewer/campus/correlation and version increment.");
  if (additionRollbackOnly) return;
  const input = { firstName: "Lead", lastName: "Synthétique", email: "audit-cycle@example.invalid", campus: "SYNTHETIC-A", program: "SYNTHETIC-PROGRAM", campaign: "SYNTHETIC-CAMPAIGN", educationLevel: "BAC", source: "TEST" };
  const initialAuditCount = await client.auditEvent.count();
  const spoof = await request("/leads", "POST", { ...input, actorId: outsider.id }, "cycle-spoof");
  assert.equal(spoof.status, 400); assert.equal(await client.auditEvent.count(), initialAuditCount);
  const created = await success<{ lead: { id: string } }>("/leads", "POST", input, "cycle-create", 201), id = created.lead.id;
  const interaction = await success<{ id: string }>(`/leads/${id}/timeline`, "POST", { type: "COMMENT", result: "SYNTHETIC_NOTE" }, "cycle-activity", 201);
  const replay = await success<{ id: string }>(`/leads/${id}/timeline`, "POST", { type: "COMMENT", result: "SYNTHETIC_NOTE" }, "cycle-activity", 201);
  assert.deepEqual(replay, interaction); assert.equal(await client.auditEvent.count({ where: { resourceId: id } }), 2, "authenticated replay creates no duplicate");
  report("HTTP interaction replay: identical result, exactly two audits for creation and interaction.");
  await success(`/leads/${id}/timeline/${interaction.id}/corrections`, "POST", { idempotencyKey: "cycle-correction", expectedCorrectionCount: 0, operation: "CANCEL", reasonCode: "DUPLICATE_ENTRY" }, "cycle-correction", 201);
  await success(`/leads/${id}/status`, "PATCH", { status: "CONTACTED", reason: "Contact synthétique" }, "cycle-status", 200);
  await success(`/leads/${id}/assignment`, "POST", { targetUserId: actor.id, confirmed: true, idempotencyKey: "cycle-assignment" }, "cycle-assignment", 201);
  const collaboration = await success<{ id: string }>(`/leads/${id}/collaboration-requests`, "POST", { targetUserId: reviewer.id, action: "ADD", role: "ADVISER", justification: "Collaboration synthétique" }, "cycle-collaboration-request", 201);
  await success(`/collaboration-requests/${collaboration.id}/decision`, "PATCH", { decision: "APPROVE", expectedVersion: 1, reason: "Validation synthétique" }, "cycle-collaboration-decision", 200, reviewer);
  const events = await client.auditEvent.findMany({ where: { resourceId: id }, orderBy: { occurredAt: "asc" } });
  assert.equal(events.length, 7); assert.equal(await client.leadMutationReceipt.count({ where: { leadId: id } }), 7);
  assert.deepEqual(events.map((event) => event.eventType), ["LEAD_CREATED", "LEAD_ACTIVITY_ADDED", "LEAD_ACTIVITY_COMPENSATED", "LEAD_STATUS_CHANGED", "LEAD_ASSIGNED", "COLLABORATION_REQUESTED", "COLLABORATION_DECIDED"]);
  assert.deepEqual(events.map((event) => event.correlationId), ["cycle-create", "cycle-activity", "cycle-correction", "cycle-status", "cycle-assignment:0", "cycle-collaboration-request", "cycle-collaboration-decision"]);
  assert.deepEqual(events.map((event) => event.actorId), [actor.id, actor.id, actor.id, actor.id, actor.id, actor.id, reviewer.id]);
  for (const event of events) {
    assert.deepEqual(event.actorRoles, ["ADMIN"]); assert.equal(event.campusId, "SYNTHETIC-A"); assert.equal(event.resourceType, "LEAD"); assert.equal(event.result, "SUCCESS");
    assert.equal(event.sessionId, null); assert.equal(event.minimizedIp, null);
    assert.deepEqual(Object.keys(event.after as object).sort(), ["scope", "version"]);
    assert.equal((event.after as { scope: string }).scope, "CAMPUS");
    for (const excluded of [input.email, actor.token, actor.sessionId, "password", "token", "hash"]) assert.equal(JSON.stringify(event.after).includes(excluded), false);
  }
  report("Seven authenticated mutations: seven audit events, correct actors/actions/correlations and sanitized metadata.");
  async function state(): Promise<unknown> {
    return { lead: await client.lead.findUniqueOrThrow({ where: { id } }), activities: await client.leadActivity.findMany({ where: { leadId: id }, orderBy: { id: "asc" } }), receipts: await client.leadMutationReceipt.findMany({ where: { leadId: id }, orderBy: { idempotencyKey: "asc" } }), audit: await client.auditEvent.findMany({ where: { resourceId: id }, orderBy: { id: "asc" } }), collaborators: await client.leadCollaborator.findMany({ where: { leadId: id }, orderBy: { userId: "asc" } }) };
  }
  const baseline = await state();
  const blocked = await request(`/leads/${id}/status`, "PATCH", { status: "QUALIFIED" }, "cycle-cross-campus", outsider);
  const absent = await request(`/leads/${randomUUID()}/status`, "PATCH", { status: "QUALIFIED" }, "cycle-absent", outsider);
  assert.equal(blocked.status, 403); assert.equal(absent.status, blocked.status);
  assert.deepEqual(await blocked.json(), await absent.json()); assert.deepEqual(await state(), baseline);
  const invalid = await request(`/leads/${id}/status`, "PATCH", { status: "UNKNOWN" }, "cycle-invalid");
  assert.equal(invalid.status, 400); assert.deepEqual(await state(), baseline);
  report("Campus isolation and invalid business mutation: refused with unchanged persistent state.");
  // Test-only DDL: exclusively the newly-created tmpfs database, never a production migration.
  await client.$executeRawUnsafe("CREATE FUNCTION crmy54_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.correlation_id = 'cycle-audit-failure' THEN RAISE EXCEPTION 'synthetic_audit_write_failure'; END IF; RETURN NEW; END $$");
  await client.$executeRawUnsafe("CREATE TRIGGER crmy54_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION crmy54_fail_audit()");
  const removal = await success<{ id: string }>(`/leads/${id}/collaboration-requests`, "POST", { targetUserId: reviewer.id, action: "REMOVE", role: "ADVISER", justification: "Test rollback synthétique" }, "cycle-removal-request", 201);
  const beforeFailure = await state();
  try {
    const failed = await request(`/collaboration-requests/${removal.id}/decision`, "PATCH", { decision: "APPROVE", expectedVersion: 1, reason: "Échec local contrôlé" }, "cycle-audit-failure", reviewer);
    assert.equal(failed.status, 503); assert.deepEqual(await failed.json(), { code: "permission_store_unavailable" });
    assert.deepEqual(await state(), beforeFailure, "audit insert failure rolls back lead, membership, receipt and timeline");
    assert.equal((await client.leadCollaborationRequest.findUniqueOrThrow({ where: { id: removal.id } })).state, "PENDING");
    report("PostgreSQL audit insert failure: complete rollback of lead, version, membership, timeline, receipt and decision.");
  } finally {
    await client.$executeRawUnsafe("DROP TRIGGER crmy54_audit_failure ON audit_events");
    await client.$executeRawUnsafe("DROP FUNCTION crmy54_fail_audit()");
  }
  const latest = await client.lead.findUniqueOrThrow({ where: { id } }), beforeRace = await client.auditEvent.count({ where: { resourceId: id } });
  const concurrent = await Promise.all([1, 2].map((number) => request(`/leads/${id}`, "PATCH", { source: `SYNTHETIC-${number}`, expectedVersion: latest.version, idempotencyKey: `cycle-race-${number}` }, `cycle-race-${number}`)));
  assert.deepEqual(concurrent.map((response) => response.status).sort(), [200, 409]);
  const conflict = concurrent.find((response) => response.status === 409)!;
  const conflictBody = await conflict.json() as { code: string };
  assert.ok(["lead_version_conflict", "permission_version_conflict"].includes(conflictBody.code));
  assert.equal((await client.lead.findUniqueOrThrow({ where: { id } })).version, latest.version + 1);
  assert.equal(await client.auditEvent.count({ where: { resourceId: id } }), beforeRace + 1);
  assert.equal(await client.leadCollaborator.count({ where: { leadId: id, userId: reviewer.id, active: true } }), 1);
  report("Concurrent HTTP edits: one success, one controlled conflict, one version increment and one audit.");
}
