import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Principal } from "../../src/auth/auth.types.js";
import { PrismaService } from "../../src/persistence/prisma.service.js";
import { TelephonyPersistenceRepository } from "../../src/telephony/telephony-persistence.repository.js";
import type { CallEvent, CallRecord, TelephonyConfiguration } from "../../src/telephony/telephony.service.js";

const enabled = process.env.CRMY165_TELEPHONY_TEST === "true";

test("telephony calls, replay, transitions and human association survive a PostgreSQL restart", { skip: !enabled }, async () => {
  const database = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["127.0.0.1", "localhost"].includes(database.hostname));
  const coverageDatabase = database.pathname === "/crmy171_synthetic";
  assert.ok(coverageDatabase || /^\/crmy165_telephony_recipe_/u.test(database.pathname));
  const prisma = new PrismaService(); const client = prisma.client; assert.ok(client);
  if (coverageDatabase) {
    const nonce = process.env.CRMY171_DATABASE_NONCE;
    assert.match(nonce ?? "", /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u);
    const identity = await client.$queryRaw<Array<{ nonce: string }>>`SELECT nonce FROM crmy171_test_identity.marker`;
    assert.deepEqual(identity, [{ nonce }]);
  }
  const repository = new TelephonyPersistenceRepository(prisma);
  const marker = randomUUID().slice(0, 8); const actorId = randomUUID(); const sessionId = randomUUID();
  const principal: Principal = { userId: actorId, roles: ["SUPER_ADMIN"], scopes: [{ kind: "GLOBAL" }], sessionId };
  const lead = await client.lead.create({ data: { leadCode: `LD-TEL-${marker.toUpperCase()}`, firstName: "Lead", lastName: "Persisté", phone: "+212600000165", campus: "SYNTHETIC", campaign: "SYNTHETIC", educationLevel: "BAC", program: "SYNTHETIC", source: "PHONE_CALL" } });
  const target = await client.lead.create({ data: { leadCode: `LD-TARGET-${marker.toUpperCase()}`, firstName: "Cible", lastName: "Persistée", phone: "+212600000166", campus: "SYNTHETIC", campaign: "SYNTHETIC", educationLevel: "BAC", program: "SYNTHETIC", source: "PHONE_CALL" } });
  const createdIds: string[] = [];
  try {
    const configuration: TelephonyConfiguration = { mode: "MANUAL_EXTERNAL", clickToCallEnabled: true, inboundEnabled: true, outboundEnabled: true, recordingPolicy: "METADATA_ONLY", maxCallDurationSeconds: 7200, version: 1, updatedBy: actorId, updatedAt: new Date().toISOString(), webhookEnabled: false };
    await repository.persistConfiguration(configuration, principal, `tel-config-${marker}`);
    const makeCall = (leadId: string | undefined, suffix: string, phone: string): { record: CallRecord; event: CallEvent } => {
      const callId = randomUUID(); const recordingId = randomUUID(); const occurredAt = new Date().toISOString(); const key = `tel-${marker}-${suffix}`;
      const event: CallEvent = { id: randomUUID(), callId, idempotencyKey: key, eventType: "STATE", state: "REQUESTED", actorId, occurredAt, receivedAt: occurredAt };
      const record: CallRecord = { id: callId, provider: "MANUAL_EXTERNAL", externalId: `external-${marker}-${suffix}`, direction: "INBOUND", state: "REQUESTED", ...(leadId ? { leadId } : {}), phoneFingerprint: phone.repeat(64).slice(0, 64), maskedPhone: `***${suffix.slice(-3)}`, dispatchState: "ACCEPTED", dispatchUpdatedAt: occurredAt, matchState: leadId ? "MATCHED" : "AMBIGUOUS", requestedAt: occurredAt, createdBy: actorId, recording: { recordingId, state: "UNAVAILABLE", provider: "MANUAL_EXTERNAL", authorizedRoles: ["MANAGER", "ADMIN", "SUPER_ADMIN"] }, events: [event] };
      return { record, event };
    };
    const first = makeCall(lead.id, "165", "a"); createdIds.push(first.record.id);
    assert.equal(await repository.persistCreate(first.record, first.event, principal, `tel-create-${marker}`), true);
    assert.equal(await repository.persistCreate(first.record, first.event, principal, `tel-create-replay-${marker}`), false);
    assert.equal(await client.telephonyCall.count({ where: { id: first.record.id } }), 1);
    assert.equal(await client.leadActivity.count({ where: { idempotencyKey: { startsWith: "telephony-activity:" }, leadId: lead.id } }), 1);
    await repository.persistDispatch(first.record.id, "ACCEPTED", "UNCERTAIN", "BRIDGE_UNREACHABLE");
    await repository.persistDispatch(first.record.id, "UNCERTAIN", "ACCEPTED");
    const endedAt = new Date(Date.parse(first.record.requestedAt) + 30_000).toISOString();
    const transition: CallEvent = { id: randomUUID(), callId: first.record.id, idempotencyKey: `tel-${marker}-ended`, eventType: "STATE", state: "ENDED", actorId, occurredAt: endedAt, receivedAt: endedAt };
    const ended: CallRecord = { ...first.record, state: "ENDED", endedAt, events: [...first.record.events, transition] };
    await repository.persistTransition(first.record, ended, transition, principal, `tel-ended-${marker}`);
    const second = makeCall(undefined, "166", "b"); createdIds.push(second.record.id); await repository.persistCreate(second.record, second.event, principal, `tel-unlinked-${marker}`);
    const association: CallEvent = { id: randomUUID(), callId: second.record.id, idempotencyKey: `association:${second.record.id}:${target.id}`, eventType: "COMPENSATION", state: "REQUESTED", actorId, reasonCode: "ASSOCIATION_CONFIRMED", occurredAt: new Date().toISOString(), receivedAt: new Date().toISOString() };
    const linked: CallRecord = { ...second.record, leadId: target.id, matchState: "CONFIRMED", events: [...second.record.events, association] };
    await repository.persistAssociation(second.record, linked, association, principal, `tel-associate-${marker}`);
    const restarted = new TelephonyPersistenceRepository(prisma); const snapshot = await restarted.snapshot();
    assert.equal(snapshot.configuration?.mode, "MANUAL_EXTERNAL");
    assert.equal(snapshot.calls.find((call) => call.id === first.record.id)?.state, "ENDED");
    assert.equal(snapshot.calls.find((call) => call.id === first.record.id)?.dispatchState, "ACCEPTED");
    assert.equal(snapshot.calls.find((call) => call.id === second.record.id)?.leadId, target.id);
    assert.equal(await client.auditEvent.count({ where: { resourceType: "TELEPHONY_CALL", resourceId: { in: createdIds } } }), 4);
  } finally {
    await client.telephonyRecordingAccessEvent.deleteMany({ where: { recording: { calls: { some: { id: { in: createdIds } } } } } });
    await client.telephonyCallEvent.deleteMany({ where: { callId: { in: createdIds } } });
    const recordingIds = (await client.telephonyCall.findMany({ where: { id: { in: createdIds } }, select: { recordingId: true } })).flatMap((row) => row.recordingId ? [row.recordingId] : []);
    await client.telephonyCall.deleteMany({ where: { id: { in: createdIds } } });
    await client.telephonyRecordingMetadata.deleteMany({ where: { id: { in: recordingIds } } });
    await client.leadActivity.deleteMany({ where: { leadId: { in: [lead.id, target.id] } } });
    await client.auditEvent.deleteMany({ where: { OR: [{ resourceId: { in: createdIds } }, { correlationId: { contains: marker } }] } });
    await client.telephonyConfiguration.deleteMany({ where: { updatedBy: actorId } });
    await client.lead.deleteMany({ where: { id: { in: [lead.id, target.id] } } });
    await prisma.onModuleDestroy();
  }
});
