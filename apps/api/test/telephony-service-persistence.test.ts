import assert from "node:assert/strict";
import test from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import { AuditService } from "../src/audit/audit.service.js";
import type { Principal } from "../src/auth/auth.types.js";
import { LeadService } from "../src/leads/lead.service.js";
import { TelephonyService, type CallRecord, type TelephonyConfiguration } from "../src/telephony/telephony.service.js";
import type { TelephonyPersistenceRepository } from "../src/telephony/telephony-persistence.repository.js";
import type { TelephonyAgentRepository } from "../src/telephony/telephony-agent.repository.js";
import { canonicalizeBridgePayload } from "../src/telephony/telephony.adapter.js";
import { TelephonyController, TelephonyBridgeController } from "../src/telephony/telephony.controller.js";
import type { AuthenticatedRequest } from "../src/auth/auth.types.js";

const admin: Principal = { userId: "synthetic-admin", roles: ["SUPER_ADMIN"], scopes: [{ kind: "GLOBAL" }], sessionId: "synthetic-session" };
const code = (expected: string) => (error: unknown): boolean => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes(expected);

// Unit boundary double: no network, SIP or real persistence. PostgreSQL contracts
// are separately exercised by the isolated integration suite.
function fixture(): { service: TelephonyService; calls: Map<string, CallRecord>; lead: ReturnType<LeadService["registerLocalLead"]>; queued: string[]; hungUp: string[]; accesses(): number; fail(value: string): void; readiness(value: boolean): void; mode(value: TelephonyConfiguration["mode"]): void } {
  const audit = new AuditService(); const leads = new LeadService(audit);
  const lead = leads.registerLocalLead({ leadCode: "LD-SERVICE", firstName: "Synthetic", lastName: "Coverage", phone: "+212600000165", campus: "CAMPUS", campaign: "TEST", program: "TEST", educationLevel: "BAC", source: "MANUAL" });
  let configuration: TelephonyConfiguration = { mode: "LINPHONE", clickToCallEnabled: true, inboundEnabled: false, outboundEnabled: true, recordingPolicy: "DISABLED", maxCallDurationSeconds: 7200, version: 1, updatedBy: admin.userId, updatedAt: new Date().toISOString(), webhookEnabled: false };
  const calls = new Map<string, CallRecord>();
  let failure = ""; let ready = true; const queued: string[] = []; const hungUp: string[] = []; let accesses = 0;
  const save = async (_previous: CallRecord, record: CallRecord): Promise<void> => { await Promise.resolve(); if (failure === "transition") throw Error("storage unavailable"); calls.set(record.id, structuredClone(record)); };
  const persistence = {
    enabled: true,
    snapshot: () => Promise.resolve(structuredClone({ configuration, calls: [...calls.values()] })),
    permissionLeadId: (id: string) => Promise.resolve(calls.has(id) ? calls.get(id)?.leadId ?? null : undefined),
    callIdForCommand: (id: string) => Promise.resolve([...calls.values()].find(call => call.externalId === id)?.id),
    persistConfiguration: async (value: TelephonyConfiguration) => { await Promise.resolve(); if (failure === "configuration") throw Error("storage unavailable"); configuration = structuredClone(value); },
    persistCreate: async (value: CallRecord) => { await Promise.resolve(); if (failure === "create") throw Error("storage unavailable"); calls.set(value.id, structuredClone(value)); return true; },
    persistDispatch: async (id: string, _from: string, state: CallRecord["dispatchState"], reason?: string) => { await Promise.resolve(); const value = calls.get(id); if (value) calls.set(id, { ...value, dispatchState: state, ...(reason ? { dispatchErrorCode: reason } : {}) }); },
    persistTransition: save,
    persistAssociation: save,
    persistCompensation: async (value: CallRecord) => { await Promise.resolve(); if (failure === "compensation") throw Error("storage unavailable"); calls.set(value.id, structuredClone(value)); },
    persistRecordingAccess: async () => { await Promise.resolve(); accesses++; },
  } as unknown as TelephonyPersistenceRepository;
  const agents = {
    enabled: true,
    readiness: () => Promise.resolve({ available: ready, reason: ready ? "READY" : "WORKSTATION_OFFLINE", identityLabel: "Synthetic agent" }),
    enqueue: async (id: string) => { await Promise.resolve(); if (failure === "dispatch") throw Error("agent unavailable"); queued.push(id); },
    requestHangup: async (id: string) => { await Promise.resolve(); hungUp.push(id); },
  } as unknown as TelephonyAgentRepository;
  const service = new TelephonyService(audit, leads, persistence, agents);
  return { service, calls, lead, queued, hungUp, accesses: (): number => accesses, fail: (value: string): void => { failure = value; }, readiness: (value: boolean): void => { ready = value; }, mode: (value: TelephonyConfiguration["mode"]): void => { configuration.mode = value; configuration.inboundEnabled = value === "MANUAL_EXTERNAL"; } };
}

test("persistent orchestration reloads configuration, dispatches once and replays without recomposition", async () => {
  const f = fixture(); await f.service.onModuleInit();
  assert.equal((await f.service.configurationForApi(admin)).outboundReadiness.identityLabel, "Synthetic agent");
  const first = await f.service.initiateForApi(f.lead.id, { idempotencyKey: "synthetic-request" }, admin, "create");
  assert.equal(first.dispatchState, "ACCEPTED"); assert.deepEqual(f.queued, [first.id]);
  assert.equal((await f.service.initiateForApi(f.lead.id, { idempotencyKey: "synthetic-request" }, admin, "replay")).id, first.id);
  assert.equal(f.queued.length, 1); assert.equal(await f.service.permissionLeadIdForApi(first.id), f.lead.id);
  await assert.rejects(f.service.permissionLeadIdForApi("missing"), code("call_not_found"));
  const ended = await f.service.endForApi(first.id, admin, "hangup"); assert.equal(ended.accepted, true); assert.deepEqual(f.hungUp, [first.id]);
  assert.equal((await f.service.callForApi(first.id, admin, "read")).state, "REQUESTED");
  assert.equal((await f.service.callsForLeadForApi(f.lead.id, admin, "list")).items.length, 1);
  assert.equal((await f.service.recordingForApi(first.id, admin, "metadata")).state, "UNAVAILABLE"); assert.equal(f.accesses(), 1);
  const time = new Date(Date.parse(first.requestedAt) + 1000).toISOString();
  await f.service.receiveAgentEventForApi(first.id, { idempotencyKey: "synthetic-answer", state: "ANSWERED", occurredAt: time }, admin, "answer");
  const final = await f.service.receiveAgentEventForApi(first.id, { idempotencyKey: "synthetic-ended", state: "ENDED", occurredAt: new Date(Date.parse(time) + 9000).toISOString() }, admin, "end");
  assert.equal(final.durationSeconds, 9); assert.equal(final.events.length, 3);
  assert.equal((await f.service.receiveAgentEventForApi(first.id, { idempotencyKey: "synthetic-ended", state: "ENDED" }, admin, "replay")).events.length, 3);
  await assert.rejects(f.service.endForApi(first.id, admin, "again"), code("telephony_call_not_active"));
});

test("dispatch failure remains uncertain and retry never enqueues another call", async () => {
  const f = fixture(); f.fail("dispatch");
  await assert.rejects(f.service.initiateForApi(f.lead.id, { idempotencyKey: "uncertain-request" }, admin, "create"), /agent unavailable/);
  const stored = [...f.calls.values()][0]; assert.ok(stored); assert.equal(stored.dispatchState, "UNCERTAIN");
  f.fail(""); const replay = await f.service.initiateForApi(f.lead.id, { idempotencyKey: "uncertain-request" }, admin, "retry");
  assert.equal(replay.id, stored.id); assert.equal(f.queued.length, 0);
  const observed = await f.service.receiveAgentEventForApi(stored.id, { idempotencyKey: "observed-dialing", state: "DIALING", occurredAt: new Date(Date.parse(stored.requestedAt) + 1000).toISOString() }, admin, "observed");
  assert.equal(observed.dispatchState, "ACCEPTED"); assert.equal(observed.state, "DIALING");
  await assert.rejects(f.service.receiveAgentEventForApi(stored.id, { reasonCode: "private arbitrary text" }, admin, "bad"), code("telephony_agent_reason_invalid"));
  await assert.rejects(f.service.receiveAgentEventForApi("absent", {}, admin, "bad"), code("telephony_call_not_found"));
});

test("free calls validate purpose and Morocco destination, normalize once and retain uncertainty", async () => {
  const f = fixture(); const input = { phone: "06 00 00 01 65", purposeCode: "PARTNER", comment: " Synthetic ", idempotencyKey: "free-synthetic-01" };
  const created = await f.service.initiateFreeForApi(input, admin, "free");
  assert.equal(created.leadId, undefined); assert.equal(created.purposeComment, "Synthetic"); assert.equal(created.maskedPhone, "***165");
  assert.equal(await f.service.permissionLeadIdForApi(created.id), undefined);
  assert.equal((await f.service.initiateFreeForApi(input, admin, "replay")).id, created.id); assert.equal(f.queued.length, 1);
  for (const [patch, expected] of [[{ purposeCode: "UNKNOWN" }, "telephony_free_call_purpose_invalid"], [{ comment: "line\nbreak" }, "telephony_free_call_comment_invalid"], [{ phone: "+33600000165" }, "telephony_free_call_destination_refused"], [{ idempotencyKey: "x" }, "telephony_idempotency_invalid"]] as const) {
    await assert.rejects(f.service.initiateFreeForApi({ ...input, ...patch }, admin, "invalid"), code(expected));
  }
  f.readiness(false); await assert.rejects(f.service.initiateFreeForApi({ ...input, idempotencyKey: "free-offline-01" }, admin, "offline"), code("telephony_bridge_not_ready"));
  f.readiness(true); f.fail("dispatch"); await assert.rejects(f.service.initiateFreeForApi({ ...input, phone: "212600000166", idempotencyKey: "free-uncertain-01" }, admin, "uncertain"), /agent unavailable/);
  assert.equal([...f.calls.values()].find(c => c.maskedPhone === "***166")?.dispatchState, "UNCERTAIN");
  f.mode("DISABLED"); await assert.rejects(f.service.initiateFreeForApi(input, admin, "disabled"), code("telephony_provider_disabled"));
});

test("configuration and failed writes restore authoritative state, not optimistic memory", async () => {
  const f = fixture(); const config = { expectedVersion: 1, mode: "LINPHONE" as const, outboundEnabled: true, clickToCallEnabled: true, recordingPolicy: "DISABLED" as const, maxCallDurationSeconds: 7200 };
  f.readiness(false); await assert.rejects(f.service.configureForApi(config, admin, "offline"), code("telephony_bridge_not_ready"));
  f.readiness(true); f.fail("configuration"); await assert.rejects(f.service.configureForApi(config, admin, "fail"), /storage unavailable/); assert.equal(f.service.configuration().version, 1);
  f.fail(""); assert.equal((await f.service.configureForApi(config, admin, "ok")).version, 2);
  f.fail("create"); await assert.rejects(f.service.initiateForApi(f.lead.id, { idempotencyKey: "create-failure-01" }, admin, "fail"), /storage unavailable/); assert.equal(f.calls.size, 0);
  f.fail(""); const created = await f.service.initiateForApi(f.lead.id, { idempotencyKey: "create-success-01" }, admin, "ok");
  f.fail("transition"); await assert.rejects(f.service.receiveEventForApi(created.id, { idempotencyKey: "transition-fail-01", state: "DIALING" }, admin, "fail"), /storage unavailable/);
  assert.equal((await f.service.callForApi(created.id, admin, "read")).state, "REQUESTED");
  f.fail("compensation"); await assert.rejects(f.service.compensateForApi(created.id, { idempotencyKey: "compensation-fail", reasonCode: "WRONG_RESULT" }, admin, "fail"), /storage unavailable/);
  f.fail(""); assert.equal((await f.service.compensateForApi(created.id, { idempotencyKey: "compensation-ok-1", reasonCode: "WRONG_RESULT" }, admin, "ok")).events.length, 2);
});

test("manual incoming orchestration persists human association without enabling a provider", async () => {
  const f = fixture(); f.mode("MANUAL_EXTERNAL");
  const incoming = { provider: "MANUAL_EXTERNAL" as const, externalId: "synthetic-incoming", phone: "+212600000166", idempotencyKey: "incoming-service-01", occurredAt: new Date().toISOString() };
  f.fail("create"); await assert.rejects(f.service.ingestSyntheticIncomingForApi(incoming, admin, "fail"), /storage unavailable/);
  f.fail(""); const call = await f.service.ingestSyntheticIncomingForApi(incoming, admin, "ok");
  assert.equal(call.matchState, "UNMATCHED"); assert.equal((await f.service.queueForApi(admin)).toVerify.length, 1);
  await assert.rejects(f.service.endForApi(call.id, admin, "bad"), code("telephony_end_not_supported"));
  const outgoing = await f.service.initiateForApi(f.lead.id, { idempotencyKey: "manual-service-01" }, admin, "manual"); assert.equal(outgoing.provider, "MANUAL_EXTERNAL");
  assert.equal((await f.service.configurationForApi()).outboundReadiness.reason, "MODE_DISABLED");
});

test("signed bridge events reject altered, expired and unknown commands before changing state", async t => {
  const secret = "synthetic-bridge-test-secret-never-used-outside-tests"; const bridgeId = "synthetic-bridge";
  const previous = { secret: process.env.TELEPHONY_LINPHONE_BRIDGE_SECRET, id: process.env.TELEPHONY_LINPHONE_BRIDGE_ID };
  t.after(() => { for (const [key, value] of [["TELEPHONY_LINPHONE_BRIDGE_SECRET", previous.secret], ["TELEPHONY_LINPHONE_BRIDGE_ID", previous.id]]) { if (value === undefined) delete process.env[key!]; else process.env[key!] = value; } });
  process.env.TELEPHONY_LINPHONE_BRIDGE_SECRET = secret; process.env.TELEPHONY_LINPHONE_BRIDGE_ID = bridgeId;
  const f = fixture(); const created = await f.service.initiateForApi(f.lead.id, { idempotencyKey: "bridge-request-01" }, admin, "create");
  const body = { schemaVersion: "1" as const, commandId: created.externalId, eventId: "bridge-answer-01", state: "ANSWERED" as const, occurredAt: new Date(Date.parse(created.requestedAt) + 1000).toISOString() };
  const sign = (value: typeof body, timestamp = String(Date.now())): { bridgeId: string; timestamp: string; nonce: string; signature: string } => {
    const nonce = randomUUID(); return { bridgeId, timestamp, nonce, signature: `sha256=${createHmac("sha256", secret).update(`${bridgeId}.${timestamp}.${nonce}.${canonicalizeBridgePayload(value)}`).digest("hex")}` };
  };
  await assert.rejects(f.service.receiveBridgeEventForApi(body, { ...sign(body), signature: `sha256=${"0".repeat(64)}` }), code("telephony_bridge_authentication_refused"));
  await assert.rejects(f.service.receiveBridgeEventForApi(body, sign(body, "1000000000000")), code("telephony_bridge_authentication_refused"));
  const unknown = { ...body, commandId: randomUUID() }; await assert.rejects(f.service.receiveBridgeEventForApi(unknown, sign(unknown)), code("telephony_command_not_found"));
  const malformed = { ...body, eventId: "x" }; await assert.rejects(f.service.receiveBridgeEventForApi(malformed, sign(malformed)), code("telephony_bridge_event_invalid"));
  f.calls.set(created.id, { ...created, dispatchState: "UNCERTAIN" });
  const result = await f.service.receiveBridgeEventForApi(body, sign(body)); assert.equal(result.state, "ANSWERED"); assert.equal(result.dispatchState, "ACCEPTED"); assert.equal(result.events.length, 2);
  const controller = new TelephonyBridgeController(f.service); const headers = sign(body);
  assert.equal((await controller.event(body, headers.bridgeId, headers.timestamp, headers.nonce, headers.signature)).events.length, 2);
  await assert.rejects(controller.event(body, undefined, undefined, undefined, undefined), code("telephony_bridge_authentication_refused"));
  process.env.TELEPHONY_LINPHONE_BRIDGE_SECRET = ""; await assert.rejects(f.service.receiveBridgeEventForApi(body, sign(body)), code("telephony_bridge_not_configured"));
});

test("browser controller routes delegate to the same durable orchestration and validate association input", async () => {
  const f = fixture(); f.mode("MANUAL_EXTERNAL"); const controller = new TelephonyController(f.service);
  const request = { principal: admin, header: () => undefined } as unknown as AuthenticatedRequest;
  assert.equal((await controller.configuration(request)).mode, "MANUAL_EXTERNAL");
  await controller.configure({ expectedVersion: 1, mode: "MANUAL_EXTERNAL", outboundEnabled: true, clickToCallEnabled: true, inboundEnabled: true, recordingPolicy: "DISABLED", maxCallDurationSeconds: 7200 }, request);
  const call = await controller.initiate(f.lead.id, { idempotencyKey: "controller-request" }, request);
  assert.equal((await controller.detail(call.id, request)).id, call.id); assert.equal((await controller.listLeadCalls(f.lead.id, request)).items.length, 1);
  assert.equal((await controller.recording(call.id, request)).state, "UNAVAILABLE"); assert.equal((await controller.associationCandidates(call.id, request)).items.length, 0);
  assert.equal((await controller.queue(request)).toVerify.length, 0);
  await controller.event(call.id, { idempotencyKey: "controller-dialing", state: "DIALING" }, request);
  assert.equal((await controller.compensate(call.id, { idempotencyKey: "controller-correct", reasonCode: "WRONG_RESULT" }, request)).events.length, 3);
  assert.throws(() => controller.associate(call.id, {}, request), code("lead_id_required"));
  await assert.rejects(controller.associate(call.id, { leadId: f.lead.id }, request), code("telephony_association_already_resolved"));
  await assert.rejects(controller.end(call.id, request), code("telephony_end_not_supported"));
});
