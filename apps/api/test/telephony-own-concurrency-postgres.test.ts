import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { Principal } from "../src/auth/auth.types.js";
import { PrismaService } from "../src/persistence/prisma.service.js";
import { TelephonyAgentRepository } from "../src/telephony/telephony-agent.repository.js";
import { callStates } from "../src/telephony/telephony.service.js";
import { acquirePermissionFence } from "../src/permissions/permission-fence.js";
import { defaultConfiguration } from "../src/permissions/dynamic-evaluator.js";
import { configurationKey } from "../src/permissions/dynamic-contract.js";
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
