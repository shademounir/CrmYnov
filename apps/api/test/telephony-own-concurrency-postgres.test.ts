import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import type { TelephonyCall, TelephonyCallEvent, TelephonyAgentCommand } from "@prisma/client";
import type { Principal } from "../src/auth/auth.types.js";
import { PrismaService } from "../src/persistence/prisma.service.js";
import { TelephonyAgentRepository } from "../src/telephony/telephony-agent.repository.js";
import { callStates } from "../src/telephony/telephony.service.js";
import { acquirePermissionFence } from "../src/permissions/permission-fence.js";
import { defaultConfiguration } from "../src/permissions/dynamic-evaluator.js";
import { configurationKey, type Grants } from "../src/permissions/dynamic-contract.js";
import { ownTelephonyFixture } from "./fixtures/telephony-own-fixture.js";

const code = (expected: string): ((error: unknown) => boolean) => (error: unknown): boolean => JSON.stringify((error as { getResponse?: () => unknown }).getResponse?.()).includes(expected);
const options = { skip: process.env.CRMY176_EPHEMERAL_TEST !== "true", timeout: 90_000 };

test("CRMY-176 two database connections serialize pairing, revocation, stale tokens and all nonterminal call states", options, async () => {
  const f = await ownTelephonyFixture(); const otherPrisma = new PrismaService();
  const first = new TelephonyAgentRepository(f.prisma), second = new TelephonyAgentRepository(otherPrisma);
  const admin = await f.db.collaborator.create({ data: { professionalEmail: `concurrency-admin-${f.suffix.toLowerCase()}@example.invalid`, professionalDisplayName: "Synthetic concurrency administrator", roles: ["SUPER_ADMIN"], active: true, firstLoginRequired: false } });
  const principal: Principal = { userId: admin.id, roles: ["SUPER_ADMIN"], scopes: [{ kind: "GLOBAL" }], sessionId: randomUUID() };
  // This explicit synthetic administrator creates only temporary CRM association codes, not SIP secrets.
  const payload = (pairing: string, suffix: string): Parameters<TelephonyAgentRepository["pair"]>[0] => ({ code: pairing, publicId: `race-${f.suffix}-${suffix}`, displayName: "Synthetic concurrency workstation", agentVersion: "0.4.7-pilot", sdkVersion: "5.5.21" });
  try {
    const pairing = await first.createPairingCode(f.profile.id, principal);
    const race = await Promise.allSettled([first.pair(payload(pairing.code, "a")), second.pair(payload(pairing.code, "b"))]);
    assert.equal(race.filter((row) => row.status === "fulfilled").length, 1);
    const winner = (race.find((row) => row.status === "fulfilled") as PromiseFulfilledResult<{ token: string; workstationId: string }>).value;
    assert.equal(await f.db.telephonyWorkstation.count({ where: { userProfileId: f.profile.id, active: true } }), 1);
    assert.equal(await f.db.auditEvent.count({ where: { eventType: "TELEPHONY_WORKSTATION_PAIRED", resourceId: winner.workstationId } }), 1);
    await assert.rejects(() => second.pair(payload(pairing.code, "replay")), code("telephony_pairing_code_refused"));
    const identity = await first.authenticate(winner.token);
    const currentProfile = await f.db.telephonyUserProfile.findUniqueOrThrow({ where: { id: f.profile.id } });
    await assert.rejects(() => first.upsertUserProfile({ userId: f.commercial.id, serverProfileId: f.server.id, sipAddress: "sip:999@sip.example.invalid", authUsername: currentProfile.authUsername, enabled: true, expectedVersion: currentProfile.version }, principal), code("telephony_profile_requires_repairing"));
    await assert.rejects(() => first.upsertServerProfile({ id: f.server.id, name: f.server.name, sipDomain: "changed.example.invalid", proxyUri: f.server.proxyUri, transport: f.server.transport, campusId: f.server.campusId, enabled: true, expectedVersion: f.server.version }, principal), code("telephony_server_requires_repairing"));
    await first.status(identity, { connectionState: "CONNECTED", sdkLoaded: true, sipRegistered: true, inputDeviceId: "synthetic-input", outputDeviceId: "synthetic-output" });
    const heartbeat = await first.status(identity, { connectionState: "CONNECTED", sdkLoaded: true, sipRegistered: true, inputDeviceId: "synthetic-input", outputDeviceId: "synthetic-output" }) as { version: number };
    assert.equal((await second.status(identity, { connectionState: "CONNECTED", sdkLoaded: true, sipRegistered: true, inputDeviceId: "synthetic-input", outputDeviceId: "synthetic-output" }) as { version: number }).version, heartbeat.version);
    const callId = randomUUID(); const terminal = new Set(["ENDED", "FAILED", "MISSED", "CANCELLED"]);
    await f.db.telephonyCall.create({ data: { id: callId, provider: "LINPHONE", externalId: randomUUID(), direction: "OUTBOUND", state: "REQUESTED", phoneFingerprint: "b".repeat(64), maskedPhone: "***000", dispatchState: "UNCERTAIN", matchState: "UNMATCHED", requestedAt: new Date(), createdBy: f.commercial.id, recording: { create: { provider: "LINPHONE", state: "UNAVAILABLE", authorizedRoles: ["SUPER_ADMIN"] } } } });
    for (const state of callStates.filter((value) => !terminal.has(value))) {
      await f.db.telephonyCall.update({ where: { id: callId }, data: { state } });
      await assert.rejects(() => first.revokeWorkstation(winner.workstationId, principal), code("telephony_workstation_busy"));
      assert.equal((await first.authenticate(winner.token)).workstationId, winner.workstationId);
    }
    await f.db.telephonyCall.update({ where: { id: callId }, data: { state: "ENDED", endedAt: new Date() } });
    await Promise.allSettled([first.revokeWorkstation(winner.workstationId, principal), second.status(identity, { connectionState: "CONNECTED", sdkLoaded: true, sipRegistered: true })]);
    assert.equal((await f.db.telephonyWorkstation.findUniqueOrThrow({ where: { id: winner.workstationId } })).active, false);
    await assert.rejects(() => second.authenticate(winner.token), code("telephony_agent_authentication_refused"));
    await assert.rejects(() => second.status(identity, { connectionState: "CONNECTED", sdkLoaded: true, sipRegistered: true }), code("telephony_agent_authentication_refused"));
    await assert.rejects(() => second.poll(identity), code("telephony_agent_authentication_refused"));
    await assert.rejects(() => second.claim(identity, randomUUID()), code("telephony_agent_authentication_refused"));
    const afterRevokedCallId = randomUUID();
    await f.db.telephonyCall.create({ data: { id: afterRevokedCallId, provider: "LINPHONE", externalId: randomUUID(), direction: "OUTBOUND", state: "REQUESTED", phoneFingerprint: "e".repeat(64), maskedPhone: "***000", requestedAt: new Date(), createdBy: f.commercial.id, recording: { create: { provider: "LINPHONE", state: "UNAVAILABLE", authorizedRoles: ["SUPER_ADMIN"] } } } });
    await assert.rejects(() => first.enqueue(afterRevokedCallId, f.commercial.id, "+212600000000"), code("telephony_agent_not_ready"));
    assert.equal(await f.db.telephonyAgentCommand.count({ where: { callId: afterRevokedCallId } }), 0, "No new command can be created after successful workstation revocation");
    await f.db.telephonyCall.update({ where: { id: afterRevokedCallId }, data: { state: "FAILED", endedAt: new Date() } });
    const previous = await f.db.telephonyWorkstation.findUniqueOrThrow({ where: { id: winner.workstationId } });
    const replacementCode = await first.createPairingCode(f.profile.id, principal);
    const replacement = await first.pair({ ...payload(replacementCode.code, "replace"), publicId: previous.publicId }) as { token: string; workstationId: string };
    assert.equal(replacement.workstationId, winner.workstationId, "Physical identity persists without duplicating the saved workstation");
    await assert.rejects(() => second.status(identity, { connectionState: "CONNECTED", sdkLoaded: true, sipRegistered: true }), code("telephony_agent_authentication_refused"));
    const replacementIdentity = await first.authenticate(replacement.token);
    await first.status(replacementIdentity, { connectionState: "CONNECTED", sdkLoaded: true, sipRegistered: true });
    assert.equal((await first.readiness(f.commercial.id)).available, true);
    // A stale authorization generation is rejected even if the role remains a contributor.
    await f.db.collaborator.update({ where: { id: f.commercial.id }, data: { authenticationVersion: { increment: 1 } } });
    await assert.rejects(() => second.poll(replacementIdentity), code("telephony_agent_authentication_refused"));
    const current = await first.authenticate(replacement.token);
    const pendingCallId = randomUUID();
    const lead = await f.db.lead.create({ data: { leadCode: `TEL-${f.suffix}`, firstName: "Synthetic", lastName: "Queued Scope", campus: f.firstCampus.code, campaign: "SYNTHETIC", program: "SYNTHETIC", educationLevel: "BAC", source: "TEST", assignedToId: f.commercial.id } });
    const pendingCall = await f.db.telephonyCall.create({ data: { id: pendingCallId, lead: { connect: { id: lead.id } }, provider: "LINPHONE", externalId: randomUUID(), direction: "OUTBOUND", state: "REQUESTED", phoneFingerprint: "d".repeat(64), maskedPhone: "***000", requestedAt: new Date(), createdBy: f.commercial.id, recording: { create: { provider: "LINPHONE", state: "UNAVAILABLE", authorizedRoles: ["SUPER_ADMIN"] } } } });
    const encryption = process.env.TELEPHONY_COMMAND_ENCRYPTION_KEY;
    process.env.TELEPHONY_COMMAND_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64");
    try {
      const enqueueRace = await Promise.allSettled([first.enqueue(pendingCallId, f.commercial.id, "+212600000000"), second.revokeWorkstation(winner.workstationId, principal)]);
      assert.equal(enqueueRace[0].status, "fulfilled"); assert.equal(enqueueRace[1].status, "rejected");
      assert.equal((await f.db.telephonyWorkstation.findUniqueOrThrow({ where: { id: winner.workstationId } })).active, true, "A pending telephonic request prevents revocation before its observed terminal state");
    }
    finally { if (encryption === undefined) delete process.env.TELEPHONY_COMMAND_ENCRYPTION_KEY; else process.env.TELEPHONY_COMMAND_ENCRYPTION_KEY = encryption; }
    const target = { kind: "ROLE" as const, role: "ADMISSIONS" as const, campus: f.firstCampus.id };
    const grants = { ...defaultConfiguration(target), "interaction.create": "NONE" };
    await f.db.$transaction(async (tx) => {
      await acquirePermissionFence(tx, "write");
      await tx.rolePermissionConfiguration.create({ data: { id: configurationKey(target), ...target, version: 1, versions: { create: { number: 1, grants: { create: Object.entries(grants).map(([permission, scope]) => ({ permission, scope })) } } } } });
    });
    await assert.rejects(() => second.claim(current, pendingCall.externalId), code("telephony_agent_command_scope_forbidden"));
    await assert.rejects(() => second.poll(current), code("telephony_agent_command_scope_forbidden"));
    assert.equal((await f.db.telephonyAgentCommand.findUniqueOrThrow({ where: { callId: pendingCallId } })).state, "PENDING", "Withdrawal of interaction.create stops a queued destination before delivery");
    await f.db.telephonyServerProfile.update({ where: { id: f.server.id }, data: { campusId: null } });
    await f.db.collaborator.update({ where: { id: f.commercial.id }, data: { campusId: f.otherCampus.id } });
    const changedScope = await first.authenticate(replacement.token);
    await assert.rejects(() => second.claim(changedScope, pendingCall.externalId), code("telephony_agent_command_scope_forbidden"));
    await assert.rejects(() => second.poll(changedScope), code("telephony_agent_command_scope_forbidden"));
    assert.equal((await f.db.telephonyAgentCommand.findUniqueOrThrow({ where: { callId: pendingCallId } })).state, "PENDING", "A queued destination is never disclosed after campus access was withdrawn");
    await f.db.telephonyAgentCommand.update({ where: { callId: pendingCallId }, data: { state: "TERMINAL", terminalAt: new Date() } });
    await f.db.telephonyCall.update({ where: { id: pendingCallId }, data: { state: "FAILED", endedAt: new Date() } });
    await f.db.collaborator.update({ where: { id: f.commercial.id }, data: { campusId: f.firstCampus.id } });
    await f.db.telephonyServerProfile.update({ where: { id: f.server.id }, data: { campusId: f.firstCampus.id } });
    await f.db.collaborator.update({ where: { id: f.commercial.id }, data: { roles: ["MANAGER"] } });
    await assert.rejects(() => second.status(current, { connectionState: "CONNECTED" }), code("telephony_agent_authentication_refused"));
    await f.db.collaborator.update({ where: { id: f.commercial.id }, data: { firstLoginRequired: true } });
    await assert.rejects(() => first.authenticate(replacement.token), code("telephony_agent_authentication_refused"));
    await f.db.collaborator.update({ where: { id: f.commercial.id }, data: { firstLoginRequired: false, campusId: f.otherCampus.id } });
    await assert.rejects(() => first.authenticate(replacement.token), code("telephony_agent_authentication_refused"));
    assert.equal((await first.readiness(f.commercial.id)).reason, "SERVER_PROFILE_SCOPE_MISMATCH");
    assert.equal(await f.db.telephonyWorkstation.count({ where: { userProfileId: f.profile.id, active: true } }), 1);
    assert.equal(await f.db.telephonyAgentCommand.count({ where: { workstationId: winner.workstationId } }), 1, "One isolated encrypted command remains undelivered; no agent or actual SIP client was run");
    const audits = await f.db.auditEvent.findMany({ where: { actorId: { in: [f.commercial.id, admin.id] }, eventType: { startsWith: "TELEPHONY_" } } });
    for (const audit of audits) {
      const text = JSON.stringify([audit.before, audit.after]);
      assert.equal(text.includes(pairing.code), false); assert.equal(text.includes(winner.token), false); assert.equal(text.includes("tokenDigest"), false);
    }
  } finally { await otherPrisma.onModuleDestroy(); await f.prisma.onModuleDestroy(); }
});

test("CRMY-176 reconciliation reads durable own receipts without delivery and serializes revocation", options, async () => {
  const f = await ownTelephonyFixture(); const otherPrisma = new PrismaService();
  const first = new TelephonyAgentRepository(f.prisma), second = new TelephonyAgentRepository(otherPrisma);
  let restoreSource: (() => Promise<void>) | undefined;
  try {
    const admin = await f.db.collaborator.create({ data: { professionalEmail: `reconcile-admin-${f.suffix.toLowerCase()}@example.invalid`, professionalDisplayName: "Synthetic reconciliation administrator", roles: ["SUPER_ADMIN"], active: true, firstLoginRequired: false } });
    // Disposable, nonce-verified database only. No agent, SDK, poll or claim is run.
    const token = `synthetic-${randomUUID()}-${randomUUID()}`;
    const workstation = await f.db.telephonyWorkstation.create({ data: {
      userProfileId: f.profile.id, publicId: `reconcile-${f.suffix}`, displayName: "Synthetic reconciliation workstation",
      tokenDigest: createHash("sha256").update(token).digest("hex"), agentVersion: "0.4.11-pilot", sdkVersion: "5.5.21",
    } });
    const otherWorkstation = await f.db.telephonyWorkstation.create({ data: {
      userProfileId: f.managerProfile.id, publicId: `reconcile-other-${f.suffix}`, displayName: "Synthetic other workstation",
      tokenDigest: createHash("sha256").update(randomUUID()).digest("hex"), agentVersion: "0.4.11-pilot", sdkVersion: "5.5.21",
    } });
    const identity = await first.authenticate(token);
    const key = `reconcile-intent-${f.suffix}`;
    // A contributor is not implicitly allowed to use the free-call capability.
    await assert.rejects(() => first.reconcileFreeCall(identity, { idempotencyKey: key }), code("telephony_agent_command_scope_forbidden"));
    const target = { kind: "ROLE" as const, role: "ADMISSIONS" as const, campus: f.firstCampus.id };
    const grants = { ...defaultConfiguration(target), "telephony.free-call.create": "CAMPUS" };
    // Campus grants restrict an existing global role delegation; they cannot
    // elevate the default ADMISSIONS source NONE. Preserve and version both.
    const sourceTarget = { ...target, campus: "GLOBAL" };
    let previousSource: Grants = defaultConfiguration(sourceTarget);
    await f.db.$transaction(async (tx) => {
      await acquirePermissionFence(tx, "write");
      const current = await tx.rolePermissionConfiguration.findUnique({ where: { id: configurationKey(sourceTarget) }, include: { versions: { include: { grants: true } } } });
      if (current) {
        const latest = current.versions.find(version => version.number === current.version);
        assert.ok(latest);
        previousSource = Object.fromEntries(latest.grants.map(grant => [grant.permission, grant.scope])) as Grants;
      }
      const version = (current?.version ?? 0) + 1;
      const next = { ...previousSource, "telephony.free-call.create": "CAMPUS" };
      const versions = { create: { number: version, grants: { create: Object.entries(next).map(([permission, scope]) => ({ permission, scope })) } } };
      await tx.rolePermissionConfiguration.upsert({ where: { id: configurationKey(sourceTarget) },
        create: { id: configurationKey(sourceTarget), ...sourceTarget, version, versions }, update: { version, versions } });
    });
    restoreSource = (): Promise<void> => f.db.$transaction(async (tx) => {
      await acquirePermissionFence(tx, "write");
      const current = await tx.rolePermissionConfiguration.findUniqueOrThrow({ where: { id: configurationKey(sourceTarget) } });
      await tx.rolePermissionConfiguration.update({ where: { id: current.id, version: current.version }, data: { version: current.version + 1,
        versions: { create: { number: current.version + 1, grants: { create: Object.entries(previousSource).map(([permission, scope]) => ({ permission, scope })) } } } } });
    });
    await f.db.$transaction(async (tx) => {
      await acquirePermissionFence(tx, "write");
      await tx.rolePermissionConfiguration.create({ data: { id: configurationKey(target), ...target, version: 1,
        versions: { create: { number: 1, grants: { create: Object.entries(grants).map(([permission, scope]) => ({ permission, scope })) } } } } });
    });
    const unknown = { idempotencyKey: key, workstationId: workstation.id, profileId: f.profile.id, outcome: "UNKNOWN" };
    assert.deepEqual(await first.reconcileFreeCall(identity, { idempotencyKey: key }), unknown);
    assert.equal(await f.db.telephonyAgentCommand.count({ where: { workstationId: workstation.id } }), 0);
    const makeCall = (receiptKey: string, owner: string, station: string): Promise<TelephonyCall> => f.db.telephonyCall.create({ data: {
      provider: "LINPHONE", externalId: randomUUID(), direction: "OUTBOUND", state: "REQUESTED", createdBy: owner,
      purposeCode: "PARTNER", phoneFingerprint: "0".repeat(64), maskedPhone: "***000", requestedAt: new Date(),
      events: { create: { idempotencyKey: receiptKey, eventType: "STATE", state: "REQUESTED", actorId: owner, occurredAt: new Date() } },
      agentCommand: { create: { workstationId: station, destinationCiphertext: "synthetic-non-deliverable", destinationIv: "synthetic", destinationTag: "synthetic", expiresAt: new Date(0) } },
    } });
    const call = await makeCall(key, f.commercial.id, workstation.id);
    const foreignCall = await makeCall(`${key}-foreign`, f.manager.id, workstation.id);
    const otherPosteCall = await makeCall(`${key}-other-poste`, f.commercial.id, otherWorkstation.id);
    for (const foreignKey of [`${key}-foreign`, `${key}-other-poste`]) {
      assert.deepEqual(await first.reconcileFreeCall(identity, { idempotencyKey: foreignKey }), { ...unknown, idempotencyKey: foreignKey });
    }
    // The expired timestamp alone does not mutate or classify the command EXPIRED.
    const state = async (): Promise<{ calls: TelephonyCall[]; events: TelephonyCallEvent[]; commands: TelephonyAgentCommand[] }> => ({
      calls: await f.db.telephonyCall.findMany({ where: { id: { in: [call.id, foreignCall.id, otherPosteCall.id] } }, orderBy: { id: "asc" } }),
      events: await f.db.telephonyCallEvent.findMany({ where: { callId: { in: [call.id, foreignCall.id, otherPosteCall.id] } }, orderBy: { id: "asc" } }),
      commands: await f.db.telephonyAgentCommand.findMany({ where: { callId: { in: [call.id, foreignCall.id, otherPosteCall.id] } }, orderBy: { id: "asc" } }),
    });
    const observe = async (outcome: string): Promise<void> => {
      const before = await state();
      const results = await Promise.all([first.reconcileFreeCall(identity, { idempotencyKey: key }), second.reconcileFreeCall(identity, { idempotencyKey: key })]);
      for (const result of results) assert.deepEqual(result, { ...unknown, outcome, callId: call.id, commandId: call.externalId });
      assert.deepEqual(await state(), before, "Reconciliation must not claim, enqueue, expire or mutate calls/events");
      assert.equal(await f.db.auditEvent.count({ where: { resourceId: f.profile.id, eventType: "TELEPHONY_INTENT_RECONCILED", after: { path: ["outcome"], equals: outcome } } }), 1, "Concurrent/replayed observations have one audit per outcome");
    };
    await observe("PENDING");
    await f.db.telephonyAgentCommand.update({ where: { callId: call.id }, data: { state: "DELIVERED", claimedAt: new Date() } });
    await observe("UNCERTAIN");
    await f.db.telephonyCall.update({ where: { id: call.id }, data: { state: "ENDED", endedAt: new Date() } });
    await observe("UNCERTAIN");
    await f.db.telephonyAgentCommand.update({ where: { callId: call.id }, data: { state: "TERMINAL", terminalAt: new Date() } });
    await observe("TERMINAL");
    // Fixture-only state changes test the non-delivery proof; never production repair.
    await f.db.telephonyCall.update({ where: { id: call.id }, data: { state: "REQUESTED", endedAt: null } });
    await f.db.telephonyAgentCommand.update({ where: { callId: call.id }, data: { state: "EXPIRED", claimedAt: null } });
    await observe("EXPIRED_UNDELIVERED");
    await f.db.telephonyAgentCommand.update({ where: { callId: call.id }, data: { claimedAt: new Date() } });
    await observe("UNCERTAIN");
    // Withdrawing the effective permission prevents even a previously safe lookup.
    const changeGrant = (scope: "NONE" | "CAMPUS"): Promise<void> => f.db.$transaction(async (tx) => {
      await acquirePermissionFence(tx, "write");
      const previous = await tx.rolePermissionConfiguration.findUniqueOrThrow({ where: { id: configurationKey(target) } });
      await tx.rolePermissionConfiguration.update({ where: { id: previous.id }, data: { version: previous.version + 1,
        versions: { create: { number: previous.version + 1, grants: { create: Object.entries({ ...grants, "telephony.free-call.create": scope }).map(([permission, value]) => ({ permission, scope: value })) } } } } });
    });
    await changeGrant("NONE");
    await assert.rejects(() => second.reconcileFreeCall(identity, { idempotencyKey: key }), code("telephony_agent_command_scope_forbidden"));
    await changeGrant("CAMPUS");
    await f.db.telephonyAgentCommand.updateMany({ where: { callId: { in: [call.id, foreignCall.id, otherPosteCall.id] } }, data: { state: "TERMINAL", terminalAt: new Date() } });
    await f.db.telephonyCall.updateMany({ where: { id: { in: [call.id, foreignCall.id, otherPosteCall.id] } }, data: { state: "FAILED", endedAt: new Date() } });
    const principal: Principal = { userId: admin.id, roles: ["SUPER_ADMIN"], scopes: [{ kind: "GLOBAL" }], sessionId: randomUUID() };
    const race = await Promise.allSettled([
      first.revokeWorkstation(workstation.id, principal),
      second.reconcileFreeCall(identity, { idempotencyKey: key }),
    ]);
    assert.equal(race[0].status, "fulfilled");
    if (race[1].status === "fulfilled") assert.equal(race[1].value.outcome, "TERMINAL");
    else assert.ok(code("telephony_agent_authentication_refused")(race[1].reason));
    await assert.rejects(() => second.reconcileFreeCall(identity, { idempotencyKey: key }), code("telephony_agent_authentication_refused"));
    await assert.rejects(() => second.authenticate(token), code("telephony_agent_authentication_refused"));
    const audits = await f.db.auditEvent.findMany({ where: { resourceId: f.profile.id, eventType: "TELEPHONY_INTENT_RECONCILED" } });
    for (const audit of audits) for (const excluded of [key, token, "destinationCiphertext", "phoneFingerprint"]) assert.equal(JSON.stringify(audit).includes(excluded), false);
  } finally {
    try { await restoreSource?.(); }
    finally { await otherPrisma.onModuleDestroy(); await f.prisma.onModuleDestroy(); }
  }
});
