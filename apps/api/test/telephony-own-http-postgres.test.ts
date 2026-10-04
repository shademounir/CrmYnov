import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApplication } from "../src/application.js";
import { DynamicPermissionService } from "../src/permissions/dynamic-service.js";
import type { OwnTelephonyView } from "../src/telephony/telephony-own.service.js";
import { ownTelephonyFixture } from "./fixtures/telephony-own-fixture.js";
import type { Principal } from "../src/auth/auth.types.js";
import { AuditService } from "../src/audit/audit.service.js";
import { LeadService } from "../src/leads/lead.service.js";
import { LeadPersistenceRepository } from "../src/leads/lead-persistence.repository.js";
import { TelephonyAgentRepository } from "../src/telephony/telephony-agent.repository.js";
import { TelephonyPersistenceRepository } from "../src/telephony/telephony-persistence.repository.js";
import { TelephonyService, type CallEvent, type CallRecord } from "../src/telephony/telephony.service.js";

test("CRMY-176 actual authenticated HTTP, own account isolation, minimal DTO, grant revocation and durable pairing", { skip: process.env.CRMY176_EPHEMERAL_TEST !== "true", timeout: 90_000 }, async () => {
  const f = await ownTelephonyFixture(); let app: Awaited<ReturnType<typeof createApplication>> | undefined;
  try {
    app = await createApplication(); await app.listen(0, "127.0.0.1");
    const endpoint = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    const http = async <T = { code?: string }>(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; body: T; cache: string | null }> => {
      const response = await fetch(`${endpoint}${path}`, { method, signal: AbortSignal.timeout(15_000), headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "x-correlation-id": "synthetic-own-telephony", ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() as T, cache: response.headers.get("cache-control") };
    };
    const login = async (actor: { email: string; password: string }): Promise<string> => {
      const result = await http<{ token: string; mustChangeSecret: boolean }>("POST", "/sessions", undefined, { email: actor.email, password: actor.password });
      assert.equal(result.status, 201); assert.equal(result.body.mustChangeSecret, false); return result.body.token;
    };
    const commercial = await login(f.commercial), manager = await login(f.manager), reader = await login(f.reader), outsider = await login(f.outsider);
    assert.equal((await http("GET", "/telephony/me")).status, 401);
    assert.equal((await http("GET", "/telephony/me", reader)).status, 403);
    const own = await http<OwnTelephonyView>("GET", `/telephony/me?userId=${f.manager.id}&campus=${f.otherCampus.id}`, commercial);
    assert.equal(own.status, 200); assert.equal(own.cache, "private, no-store"); assert.ok(own.body.profile); assert.equal(own.body.profile.id, f.profile.id); assert.equal(own.body.profile.extension, "211");
    assert.equal((await http<OwnTelephonyView>("GET", "/telephony/me", manager)).body.profile?.id, f.managerProfile.id);
    assert.equal((await http<OwnTelephonyView>("GET", "/telephony/me", outsider)).body.profile, null);
    assert.deepEqual(Object.keys(own.body.profile).sort(), ["enabled", "extension", "id", "state", "version"]);
    const safe = JSON.stringify(own.body);
    for (const value of ["sip.example.invalid", "private-auth-username", "proxyUri", "secretReference", "tokenDigest", "authUsername", "password", "inputDeviceId"]) assert.equal(safe.includes(value), false, `Own DTO must omit ${value}`);
    assert.equal((await http("GET", "/telephony/provisioning", commercial)).status, 403);
    assert.equal((await http("POST", "/telephony/me/pairing-codes", commercial, { expectedVersion: 1, userId: f.manager.id })).status, 400);
    assert.equal((await http("POST", "/telephony/me/pairing-codes", outsider, { expectedVersion: 1 })).status, 409);
    const codes = await Promise.all([http<{ code: string; version: number; profileId: string }>("POST", "/telephony/me/pairing-codes", commercial, { expectedVersion: 1 }), http<{ code: string; version: number; profileId: string }>("POST", "/telephony/me/pairing-codes", commercial, { expectedVersion: 1 })]);
    assert.deepEqual(codes.map((row) => row.status).sort(), [201, 409]);
    const code = codes.find((row) => row.status === 201)!; assert.equal(code.cache, "private, no-store"); assert.equal(code.body.profileId, f.profile.id); assert.equal(code.body.version, 2);
    assert.equal(await f.db.auditEvent.count({ where: { eventType: "TELEPHONY_PAIRING_ISSUED", resourceId: f.profile.id } }), 1);
    const pair = await http<{ token: string; workstationId: string }>("POST", "/integrations/telephony/agent/v1/pair", undefined, { code: code.body.code, publicId: `http-${f.suffix}`, displayName: "Synthetic own workstation", agentVersion: "0.4.7-pilot", sdkVersion: "5.5.21" });
    assert.equal(pair.status, 201);
    const reloaded = await http<OwnTelephonyView>("GET", "/telephony/me", commercial); assert.equal(reloaded.body.workstation?.id, pair.body.workstationId); assert.equal(reloaded.body.workstation.active, true); assert.equal(reloaded.body.canPair, false);
    assert.equal((await http("PATCH", `/telephony/me/workstations/${pair.body.workstationId}/revoke`, manager, { expectedVersion: 1 })).status, 404, "Another legitimate role cannot revoke a different account's workstation");
    const revoked = await http<OwnTelephonyView>("PATCH", `/telephony/me/workstations/${pair.body.workstationId}/revoke`, commercial, { expectedVersion: 1 }); assert.equal(revoked.status, 200); assert.equal(revoked.body.workstation?.active, false);
    assert.equal((await http("PATCH", `/telephony/me/workstations/${pair.body.workstationId}/revoke`, commercial, { expectedVersion: 1 })).status, 200);
    assert.equal(await f.db.auditEvent.count({ where: { eventType: "TELEPHONY_WORKSTATION_REVOKED", resourceId: pair.body.workstationId } }), 1);
    const revokedMachine = await fetch(`${endpoint}/integrations/telephony/agent/v1/poll`, { method: "POST", headers: { "x-telephony-agent-token": pair.body.token, "content-type": "application/json" }, body: "{}" }); assert.equal(revokedMachine.status, 401);
    const absent = await http<OwnTelephonyView>("GET", "/telephony/me", commercial); assert.equal(absent.body.canPair, true);
    const replacementCode = await http<{ code: string }>("POST", "/telephony/me/pairing-codes", commercial, { expectedVersion: absent.body.profile!.version }); assert.equal(replacementCode.status, 201);
    const replacement = await http<{ token: string; workstationId: string }>("POST", "/integrations/telephony/agent/v1/pair", undefined, { code: replacementCode.body.code, publicId: `http-${f.suffix}`, displayName: "Synthetic own workstation", agentVersion: "0.4.7-pilot", sdkVersion: "5.5.21" });
    assert.equal(replacement.status, 201); assert.equal(replacement.body.workstationId, pair.body.workstationId);
    assert.equal((await http("PATCH", `/telephony/me/workstations/${pair.body.workstationId}/revoke`, commercial, { expectedVersion: 1 })).status, 409, "A delayed retry cannot revoke a newer associated generation");
    assert.equal((await f.db.telephonyWorkstation.findUniqueOrThrow({ where: { id: pair.body.workstationId } })).active, true);
    assert.equal(await f.db.telephonyWorkstation.count({ where: { userProfileId: f.profile.id } }), 1);
    const keptProfile = await f.db.telephonyUserProfile.findUniqueOrThrow({ where: { id: f.profile.id } }); assert.equal(keptProfile.sipAddress, f.profile.sipAddress); assert.equal(keptProfile.serverProfileId, f.server.id);
    // Persisted campus-specific grants are changed only in this nonce-guarded fixture.
    const permissions = app.get(DynamicPermissionService);
    const admin = await f.db.collaborator.create({ data: { professionalEmail: `admin-${f.suffix}@example.invalid`, roles: ["SUPER_ADMIN"], active: true, firstLoginRequired: false } });
    const session = await f.db.localSession.create({ data: { id: randomUUID(), collaboratorId: admin.id, tokenDigest: randomBytes(32).toString("hex"), roles: ["SUPER_ADMIN"], scopes: [{ kind: "GLOBAL" }], authenticationVersion: 1, expiresAt: new Date(Date.now() + 3_600_000) } });
    const principal = { userId: admin.id, roles: ["SUPER_ADMIN" as const], scopes: [{ kind: "GLOBAL" as const }], sessionId: session.id };
    const target = { kind: "ROLE" as const, role: "ADMISSIONS" as const, campus: f.firstCampus.id };
    const initial = await permissions.read(principal, target);
    await permissions.save(principal, { ...target, expectedVersion: initial.version, grants: { ...initial.grants, "interaction.view": "OWN", "interaction.create": "NONE" }, confirmed: true, reason: "ACCESS_REVIEW" });
    const readOnly = await http<OwnTelephonyView>("GET", "/telephony/me", commercial); assert.equal(readOnly.status, 200); assert.equal(readOnly.body.canPair, false);
    assert.equal((await http("POST", "/telephony/me/pairing-codes", commercial, { expectedVersion: absent.body.profile!.version })).status, 403);
    const current = await permissions.read(principal, target);
    await permissions.save(principal, { ...target, expectedVersion: current.version, grants: { ...current.grants, "interaction.view": "NONE" }, confirmed: true, reason: "ACCESS_REVIEW" });
    assert.equal((await http("GET", "/telephony/me", commercial)).status, 403);
    await f.db.collaborator.update({ where: { id: f.manager.id }, data: { firstLoginRequired: true } }); assert.equal((await http("GET", "/telephony/me", manager)).status, 403);
    await f.db.localSession.updateMany({ where: { collaboratorId: f.outsider.id }, data: { active: false } }); assert.equal((await http("GET", "/telephony/me", outsider)).status, 401);
  } finally {
    if (app) { const server = app.getHttpServer() as Server; server.closeAllConnections(); await app.close(); }
    await f.prisma.onModuleDestroy();
  }
});

test("CRMY-176 durable Lead and free-call replay never reveal a foreign or changed intent, including persistence races", { skip: process.env.CRMY176_EPHEMERAL_TEST !== "true", timeout: 90_000 }, async () => {
  const f = await ownTelephonyFixture(); let app: Awaited<ReturnType<typeof createApplication>> | undefined;
  const configurationId = randomUUID();
  try {
    // A separate, activated synthetic administrator exercises the existing free-call
    // capability. No permissions or profile of an existing preview user are changed.
    await f.db.collaborator.update({ where: { id: f.commercial.id }, data: { roles: ["SUPER_ADMIN"] } });
    const principal: Principal = { userId: f.commercial.id, roles: ["SUPER_ADMIN"], scopes: [{ kind: "GLOBAL" }], sessionId: randomUUID() };
    const repository = new TelephonyPersistenceRepository(f.prisma); const agents = new TelephonyAgentRepository(f.prisma);
    await f.db.telephonyConfiguration.create({ data: { id: configurationId, mode: "LINPHONE", outboundEnabled: true, clickToCallEnabled: true, inboundEnabled: false, recordingPolicy: "DISABLED", updatedBy: principal.userId, updatedAt: new Date() } });
    const pairing = await agents.createPairingCode(f.profile.id, principal);
    const paired = await agents.pair({ code: pairing.code, publicId: `replay-${f.suffix}`, displayName: "Synthetic replay workstation", agentVersion: "0.4.7-pilot", sdkVersion: "5.5.21" }) as { token: string };
    const identity = await agents.authenticate(paired.token);
    await agents.status(identity, { connectionState: "CONNECTED", sdkLoaded: true, sipRegistered: true });
    const destination = "+212600000176";
    const makeReceipt = (key: string, owner = principal.userId, leadId?: string): { record: CallRecord; event: CallEvent } => {
      const id = randomUUID(); const now = new Date().toISOString();
      const event: CallEvent = { id: randomUUID(), callId: id, idempotencyKey: key, eventType: "STATE", state: "REQUESTED", actorId: owner, occurredAt: now, receivedAt: now };
      const record: CallRecord = { id, provider: "LINPHONE", externalId: randomUUID(), direction: "OUTBOUND", state: "ENDED", ...(leadId ? { leadId } : {}), phoneFingerprint: createHash("sha256").update(destination).digest("hex"), maskedPhone: "***176", matchState: leadId ? "MATCHED" : "UNMATCHED", requestedAt: now, endedAt: now, createdBy: owner, dispatchState: "ACCEPTED", purposeCode: "PARTNER", purposeComment: "Synthetic", recording: { recordingId: randomUUID(), provider: "LINPHONE", state: "UNAVAILABLE", authorizedRoles: ["SUPER_ADMIN"] }, events: [event] };
      return { record, event };
    };
    const ownKey = `own-free-${f.suffix}`, otherKey = `other-free-${f.suffix}`, leadKey = `lead-free-${f.suffix}`;
    const lead = await f.db.lead.create({ data: { leadCode: `FREE-${f.suffix}`, firstName: "Synthetic", lastName: "Replay collision", phone: destination, campus: f.firstCampus.code, campaign: "SYNTHETIC", program: "SYNTHETIC", educationLevel: "BAC", source: "TEST", assignedToId: principal.userId } });
    const otherLead = await f.db.lead.create({ data: { leadCode: `FREE2-${f.suffix}`, firstName: "Synthetic", lastName: "Other authorized Lead", phone: destination, campus: f.firstCampus.code, campaign: "SYNTHETIC", program: "SYNTHETIC", educationLevel: "BAC", source: "TEST", assignedToId: principal.userId } });
    const own = makeReceipt(ownKey); const foreign = makeReceipt(otherKey, f.outsider.id); const linked = makeReceipt(leadKey, principal.userId, lead.id);
    const foreignLeadKey = `foreign-lead-${f.suffix}`; const foreignLinked = makeReceipt(foreignLeadKey, f.outsider.id, lead.id);
    const changedDestinationKey = `changed-lead-${f.suffix}`; const changedDestination = makeReceipt(changedDestinationKey, principal.userId, lead.id);
    changedDestination.record.phoneFingerprint = createHash("sha256").update("+212600000177").digest("hex");
    for (const receipt of [own, foreign, linked, foreignLinked, changedDestination]) await repository.persistCreate(receipt.record, receipt.event, { ...principal, userId: receipt.record.createdBy }, `synthetic-free-seed-${receipt.record.id}`);
    const effects = async (): Promise<number[]> => Promise.all([f.db.telephonyCall.count(), f.db.telephonyCallEvent.count(), f.db.auditEvent.count(), f.db.telephonyAgentCommand.count(), f.db.leadActivity.count(), f.db.telephonyRecordingMetadata.count()]);
    app = await createApplication(); await app.listen(0, "127.0.0.1");
    const endpoint = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    const input = { phone: "06 00 00 01 76", purposeCode: "PARTNER", comment: " Synthetic ", idempotencyKey: ownKey };
    const free = async (body: typeof input): Promise<{ status: number; body: { id?: string; code?: string } }> => {
      const result = await fetch(`${endpoint}/integrations/telephony/agent/v1/free-calls`, { method: "POST", signal: AbortSignal.timeout(15_000), headers: { "x-telephony-agent-token": paired.token, "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: result.status, body: await result.json() as { id?: string; code?: string } };
    };
    const before = await effects(); const replay = await free(input); assert.equal(replay.status, 201); assert.equal(replay.body.id, own.record.id);
    for (const patch of [{ idempotencyKey: otherKey }, { idempotencyKey: leadKey }, { phone: "+212600000177" }, { purposeCode: "OTHER_AUTHORIZED" }, { comment: "Changed purpose" }]) {
      const refused = await free({ ...input, ...patch }); assert.equal(refused.status, 409); assert.equal(refused.body.code, "telephony_free_call_idempotency_conflict"); assert.equal(refused.body.id, undefined);
    }
    assert.deepEqual(await effects(), before, "Authenticated replay and refusals create no call, event, audit, activity or command");
    const login = async (actor: { email: string; password: string }): Promise<string> => {
      const result = await fetch(`${endpoint}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: actor.email, password: actor.password }) });
      assert.equal(result.status, 201); return (await result.json() as { token: string }).token;
    };
    const browser = await login(f.commercial); const outsideBrowser = await login(f.outsider);
    const leadCall = async (target: string, key: string, token = browser): Promise<{ status: number; body: { id?: string; code?: string } }> => {
      const result = await fetch(`${endpoint}/leads/${target}/calls`, { method: "POST", signal: AbortSignal.timeout(15_000), headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ idempotencyKey: key }) });
      return { status: result.status, body: await result.json() as { id?: string; code?: string } };
    };
    const beforeLeads = await effects(); const ownLeadReplay = await leadCall(lead.id, leadKey); assert.equal(ownLeadReplay.status, 201); assert.equal(ownLeadReplay.body.id, linked.record.id);
    for (const [target, key] of [[lead.id, ownKey], [lead.id, foreignLeadKey], [otherLead.id, leadKey], [lead.id, changedDestinationKey]]) {
      const refused = await leadCall(target!, key!); assert.equal(refused.status, 409); assert.equal(refused.body.code, "telephony_call_idempotency_conflict"); assert.equal(refused.body.id, undefined);
    }
    const outOfScope = await leadCall(lead.id, leadKey, outsideBrowser); assert.ok([403, 404].includes(outOfScope.status)); assert.equal(outOfScope.body.id, undefined, "Lead authorization is checked before its known replay key");
    assert.deepEqual(await effects(), beforeLeads, "Lead replay and all collisions have zero persistent business effects and zero dispatch");
    await app.close(); app = undefined;
    // Controlled interleaving: a competing durable receipt is committed after the
    // first snapshot but before persistCreate. This exercises the !created branch,
    // not a mock database or a real telephone call.
    class RacePersistence extends TelephonyPersistenceRepository {
      receipt: { record: CallRecord; event: CallEvent } | undefined;
      override async persistCreate(record: CallRecord, event: CallEvent, actor: Principal, correlation: string): Promise<boolean> {
        const winner = this.receipt; assert.ok(winner); this.receipt = undefined;
        await repository.persistCreate(winner.record, winner.event, { ...actor, userId: winner.record.createdBy }, "synthetic-durable-race-winner");
        return super.persistCreate(record, event, actor, correlation);
      }
    }
    class NoDispatchAgent extends TelephonyAgentRepository {
      override enqueue(): ReturnType<TelephonyAgentRepository["enqueue"]> { assert.fail("A replay must never enqueue a telephone command"); }
    }
    for (const kind of ["free", "lead"] as const) for (const foreignOwner of [false, true]) {
      const key = `racing-${kind}-${f.suffix}-${foreignOwner ? "foreign" : "own"}`;
      const raceRepository = new RacePersistence(f.prisma); const winner = makeReceipt(key, foreignOwner ? f.outsider.id : principal.userId, kind === "lead" ? lead.id : undefined); raceRepository.receipt = winner;
      const audit = new AuditService(); const service = new TelephonyService(audit, new LeadService(audit, new LeadPersistenceRepository(f.prisma)), raceRepository, new NoDispatchAgent(f.prisma));
      const original = await effects();
      const operation = (): Promise<CallRecord> => kind === "lead" ? service.initiateForApi(lead.id, { idempotencyKey: key }, principal, "synthetic-race") : service.initiateFreeForApi({ ...input, idempotencyKey: key }, principal, "synthetic-race");
      if (foreignOwner) await assert.rejects(operation, (error: unknown) => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes(kind === "lead" ? "telephony_call_idempotency_conflict" : "telephony_free_call_idempotency_conflict"));
      else assert.equal((await operation()).id, winner.record.id);
      const actual = await effects(); assert.deepEqual(actual, [original[0]! + 1, original[1]! + 1, original[2]! + 1, original[3], original[4]! + (kind === "lead" ? 1 : 0), original[5]! + 1], "Only the competing synthetic receipt persists; the loser creates no effect or command");
      assert.equal((await f.db.telephonyCall.findUniqueOrThrow({ where: { id: winner.record.id } })).dispatchState, "ACCEPTED", "Collision cannot mark a foreign receipt uncertain");
    }
  } finally {
    if (app) { const server = app.getHttpServer() as Server; server.closeAllConnections(); await app.close(); }
    await f.db.telephonyConfiguration.deleteMany({ where: { id: configurationId } });
    await f.prisma.onModuleDestroy();
  }
});
