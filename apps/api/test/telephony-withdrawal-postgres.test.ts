import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Principal } from "../src/auth/auth.types.js";
import { PrismaService } from "../src/persistence/prisma.service.js";
import { TelephonyAgentRepository } from "../src/telephony/telephony-agent.repository.js";
import { ownTelephonyFixture } from "./fixtures/telephony-own-fixture.js";

const options = { skip: process.env.CRMY176_EPHEMERAL_TEST !== "true", timeout: 90_000 };
const code = (expected: string) => (error: unknown): boolean => JSON.stringify((error as { getResponse?: () => unknown }).getResponse?.()).includes(expected);

async function pairedFixture() {
  const f = await ownTelephonyFixture();
  const repository = new TelephonyAgentRepository(f.prisma);
  const principal: Principal = { userId: f.commercial.id, roles: ["ADMISSIONS"], scopes: [{ kind: "CAMPUS", id: f.firstCampus.id }], sessionId: randomUUID() };
  const pairing = await repository.issuePairingCode(f.profile.id, principal, undefined, "withdrawal-synthetic-pair");
  const publicId = `withdraw-${f.suffix}`;
  const paired = await repository.pair({ code: pairing.code, publicId, displayName: "Synthetic withdrawal workstation", agentVersion: "0.4.12-pilot", sdkVersion: "5.5.21" }) as { token: string; workstationId: string };
  const workstation = await f.db.telephonyWorkstation.findUniqueOrThrow({ where: { id: paired.workstationId } });
  assert.ok(workstation.associationId);
  const request = { requestId: randomUUID(), associationId: workstation.associationId, workstationId: workstation.id, profileId: f.profile.id };
  const receiptCount = () => f.db.auditEvent.count({ where: { resourceId: f.profile.id, eventType: "TELEPHONY_PROFILE_WITHDRAWN_V1" } });
  return { ...f, repository, principal, paired, publicId, request, receiptCount };
}

test("CRMY-176 withdrawal commits one durable receipt, keeps histories and replays only the terminal read", options, async () => {
  const f = await pairedFixture();
  try {
    const beforeProfile = await f.db.telephonyUserProfile.findUniqueOrThrow({ where: { id: f.profile.id } });
    const beforeWorkstation = await f.db.telephonyWorkstation.findUniqueOrThrow({ where: { id: f.request.workstationId } });
    const receipt = await f.repository.withdrawProfile(f.paired.token, f.request, "withdrawal-synthetic-first");
    assert.equal(receipt.outcome, "WITHDRAWN");
    assert.equal(receipt.associationId, f.request.associationId);
    const profile = await f.db.telephonyUserProfile.findUniqueOrThrow({ where: { id: f.profile.id } });
    const workstation = await f.db.telephonyWorkstation.findUniqueOrThrow({ where: { id: f.request.workstationId } });
    assert.equal(workstation.active, false); assert.equal(profile.enabled, false);
    assert.equal(workstation.version, beforeWorkstation.version + 1); assert.equal(profile.version, beforeProfile.version + 1);
    assert.equal(workstation.tokenDigest, beforeWorkstation.tokenDigest, "Revocation must not erase the credential-generation trace");
    assert.equal((await f.db.telephonyServerProfile.findUniqueOrThrow({ where: { id: f.server.id } })).enabled, true);
    assert.equal((await f.db.telephonyUserProfile.findUniqueOrThrow({ where: { id: f.managerProfile.id } })).enabled, true);
    assert.equal((await f.db.collaborator.findUniqueOrThrow({ where: { id: f.commercial.id } })).active, true);
    assert.equal(await f.receiptCount(), 1);
    const auditCount = await f.db.auditEvent.count();
    assert.deepEqual(await f.repository.getWithdrawalReceipt(f.paired.token, f.request), receipt);
    assert.deepEqual(await f.repository.getWithdrawalReceipt(f.paired.token, f.request), receipt);
    assert.equal(await f.db.auditEvent.count(), auditCount, "Receipt consultation must not append an audit or mutate any state");
    await assert.rejects(() => f.repository.authenticate(f.paired.token), code("telephony_agent_authentication_refused"));
    await assert.rejects(() => f.repository.withdrawProfile(f.paired.token, f.request, "withdrawal-synthetic-post-replay"));
    assert.equal(await f.receiptCount(), 1);
    const persisted = await f.db.auditEvent.findFirstOrThrow({ where: { resourceId: f.profile.id, eventType: "TELEPHONY_PROFILE_WITHDRAWN_V1" } });
    assert.equal(JSON.stringify(persisted.after).includes(f.paired.token), false);
    assert.equal(JSON.stringify(persisted.after).includes(beforeWorkstation.tokenDigest), false);
    assert.equal(await f.db.telephonyPairingCode.count({ where: { userProfileId: f.profile.id, usedAt: null, expiresAt: { gt: new Date() } } }), 0);
  } finally { await f.db.$disconnect(); }
});

test("CRMY-176 lost response and old-token lookup cannot revoke or inspect a new association", options, async () => {
  const f = await pairedFixture();
  try {
    const oldReceipt = await f.repository.withdrawProfile(f.paired.token, f.request, "withdrawal-synthetic-lost-response");
    const administrator = await f.db.collaborator.create({ data: { professionalEmail: `withdraw-admin-${f.suffix.toLowerCase()}@example.invalid`, professionalDisplayName: "Synthetic withdrawal administrator", roles: ["SUPER_ADMIN"], active: true, firstLoginRequired: false } });
    const admin: Principal = { userId: administrator.id, roles: ["SUPER_ADMIN"], scopes: [{ kind: "GLOBAL" }], sessionId: randomUUID() };
    const disabled = await f.db.telephonyUserProfile.findUniqueOrThrow({ where: { id: f.profile.id } });
    await f.repository.upsertUserProfile({ userId: f.commercial.id, serverProfileId: f.server.id, sipAddress: f.profile.sipAddress, authUsername: f.profile.authUsername, enabled: true, expectedVersion: disabled.version }, admin);
    const pairing = await f.repository.createPairingCode(f.profile.id, admin);
    const replacement = await f.repository.pair({ code: pairing.code, publicId: f.publicId, displayName: "Synthetic reassociated workstation", agentVersion: "0.4.12-pilot", sdkVersion: "5.5.21" }) as { token: string; workstationId: string };
    assert.equal(replacement.workstationId, f.request.workstationId);
    const next = await f.db.telephonyWorkstation.findUniqueOrThrow({ where: { id: replacement.workstationId } });
    assert.ok(next.associationId);
    assert.notEqual(next.associationId, f.request.associationId);
    assert.deepEqual(await f.repository.getWithdrawalReceipt(f.paired.token, f.request), oldReceipt);
    for (const request of [{ ...f.request, requestId: randomUUID() }, { ...f.request, associationId: next.associationId }, { ...f.request, profileId: f.managerProfile.id }])
      await assert.rejects(() => f.repository.getWithdrawalReceipt(f.paired.token, request), code("telephony_withdrawal_receipt_not_found"));
    await assert.rejects(() => f.repository.getWithdrawalReceipt(replacement.token, f.request), code("telephony_withdrawal_receipt_not_found"));
    assert.deepEqual(await f.db.telephonyWorkstation.findUniqueOrThrow({ where: { id: next.id } }), next);
    assert.equal((await f.repository.authenticate(replacement.token)).workstationId, next.id);
    assert.equal(await f.receiptCount(), 1);
  } finally { await f.db.$disconnect(); }
});

test("CRMY-176 permission/campus removal and legacy or mismatched associations refuse before mutation", options, async () => {
  const f = await pairedFixture();
  try {
    await assert.rejects(() => f.repository.withdrawProfile(f.paired.token, { ...f.request, associationId: randomUUID() }, "withdrawal-synthetic-mismatch"));
    await f.db.collaborator.update({ where: { id: f.commercial.id }, data: { roles: ["AUDITOR"] } });
    await assert.rejects(() => f.repository.withdrawProfile(f.paired.token, f.request, "withdrawal-synthetic-permission"));
    await f.db.collaborator.update({ where: { id: f.commercial.id }, data: { roles: ["ADMISSIONS"], campusId: f.otherCampus.id } });
    await assert.rejects(() => f.repository.withdrawProfile(f.paired.token, f.request, "withdrawal-synthetic-campus"));
    await f.db.collaborator.update({ where: { id: f.commercial.id }, data: { campusId: f.firstCampus.id } });
    await f.db.telephonyWorkstation.update({ where: { id: f.request.workstationId }, data: { associationId: null } });
    await assert.rejects(() => f.repository.withdrawProfile(f.paired.token, f.request, "withdrawal-synthetic-legacy"));
    assert.equal((await f.db.telephonyWorkstation.findUniqueOrThrow({ where: { id: f.request.workstationId } })).active, true);
    assert.equal((await f.db.telephonyUserProfile.findUniqueOrThrow({ where: { id: f.profile.id } })).enabled, true);
    assert.equal(await f.receiptCount(), 0);
  } finally { await f.db.$disconnect(); }
});

test("CRMY-176 UNCERTAIN with terminalAt and REQUESTED calls still fence withdrawal", options, async () => {
  const f = await pairedFixture();
  try {
    const call = await f.db.telephonyCall.create({ data: { provider: "LINPHONE", externalId: randomUUID(), direction: "OUTBOUND", state: "REQUESTED", phoneFingerprint: "c".repeat(64), maskedPhone: "***000", dispatchState: "UNCERTAIN", matchState: "UNMATCHED", requestedAt: new Date(), createdBy: f.commercial.id, recording: { create: { provider: "LINPHONE", state: "UNAVAILABLE", authorizedRoles: ["SUPER_ADMIN"] } } } });
    const command = await f.db.telephonyAgentCommand.create({ data: { callId: call.id, workstationId: f.request.workstationId, destinationCiphertext: "synthetic-not-dispatched", destinationIv: "0".repeat(24), destinationTag: "0".repeat(32), state: "UNCERTAIN", expiresAt: new Date(), terminalAt: new Date() } });
    await assert.rejects(() => f.repository.withdrawProfile(f.paired.token, f.request, "withdrawal-synthetic-uncertain"));
    await f.db.telephonyAgentCommand.update({ where: { id: command.id }, data: { state: "EXPIRED", claimedAt: null } });
    await assert.rejects(() => f.repository.withdrawProfile(f.paired.token, f.request, "withdrawal-synthetic-requested"));
    assert.equal(await f.receiptCount(), 0);
    assert.equal((await f.db.telephonyWorkstation.findUniqueOrThrow({ where: { id: f.request.workstationId } })).active, true);
  } finally { await f.db.$disconnect(); }
});

test("CRMY-176 concurrent retirement requests produce at most one commit and no resurrected access", options, async () => {
  const f = await pairedFixture(); const other = new PrismaService();
  try {
    const second = new TelephonyAgentRepository(other);
    const results = await Promise.allSettled([
      f.repository.withdrawProfile(f.paired.token, f.request, "withdrawal-synthetic-race-one"),
      second.withdrawProfile(f.paired.token, f.request, "withdrawal-synthetic-race-two"),
    ]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    const receipt = (results.find(r => r.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<TelephonyAgentRepository["withdrawProfile"]>>>).value;
    assert.deepEqual(await second.getWithdrawalReceipt(f.paired.token, f.request), receipt);
    assert.equal(await f.receiptCount(), 1);
    assert.equal((await f.db.telephonyWorkstation.findUniqueOrThrow({ where: { id: f.request.workstationId } })).active, false);
  } finally { await other.client?.$disconnect(); await f.db.$disconnect(); }
});
