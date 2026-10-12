import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { PrismaService } from "../src/persistence/prisma.service.js";
import { TelephonyAgentRepository, type AgentIdentity } from "../src/telephony/telephony-agent.repository.js";
import { TelephonyAgentController } from "../src/telephony/telephony.controller.js";
import type { TelephonyService } from "../src/telephony/telephony.service.js";
import type { DynamicPermissionRepository } from "../src/permissions/dynamic-repository.js";

const key = "synthetic-free-intent-176";
const token = "synthetic-reconciliation-machine-token-176";
const identity: AgentIdentity = { workstationId: "workstation-176", profileId: "profile-176", userId: "synthetic-owner-176", roles: ["SUPER_ADMIN"], tokenDigest: createHash("sha256").update(token).digest("hex"), authenticationVersion: 3 };
const code = (value: string) => (error: unknown): boolean => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes(value);

// Deliberately in-memory boundary double: no PostgreSQL, network, SIP, or SDK.
// All production auth/lock/permission/classification code runs unchanged.
function fixture() {
  const order: string[] = [];
  const audits = new Map<string, unknown>();
  const user = { active: true, firstLoginRequired: false, authenticationVersion: 3, campusId: null as string | null, roles: ["SUPER_ADMIN"] };
  const profile = { id: identity.profileId, userId: identity.userId, enabled: true, serverProfileId: "server-176", user, serverProfile: { enabled: true, campusId: null as string | null } };
  const workstation = { id: identity.workstationId, userProfileId: identity.profileId, active: true, tokenDigest: identity.tokenDigest, userProfile: profile };
  const command = { workstationId: identity.workstationId, state: "PENDING", claimedAt: null as Date | null, terminalAt: null as Date | null };
  const call = { id: "call-176", externalId: "external-command-176", state: "REQUESTED", createdBy: identity.userId, provider: "LINPHONE", direction: "OUTBOUND", leadId: null as string | null, purposeCode: "PARTNER", agentCommand: command as typeof command | null };
  const receipt = { idempotencyKey: key, eventType: "STATE", state: "REQUESTED", actorId: identity.userId, call };
  let exists = true;
  let beforeProfileLock: (() => void | Promise<void>) | undefined;
  let beforeReceipt: (() => void | Promise<void>) | undefined;
  let auditFailure = false;
  let lastQuery: unknown;
  const tx = {
    $executeRaw: async (parts: TemplateStringsArray) => { order.push(parts.join("?")); return 1; },
    $queryRaw: async (parts: TemplateStringsArray) => { const sql = parts.join("?"); order.push(sql); if (sql.includes("telephony_user_profiles")) await beforeProfileLock?.(); return []; },
    telephonyUserProfile: { findUnique: async () => ({ serverProfileId: profile.serverProfileId }) },
    telephonyWorkstation: { findUnique: async (query: { where: { id?: string; tokenDigest?: string } }) => {
      order.push("identity");
      return query.where.tokenDigest && query.where.tokenDigest !== workstation.tokenDigest ? null : workstation;
    } },
    collaborator: { findUnique: async () => user },
    crmReference: { findUnique: async () => ({ id: user.campusId, kind: "CAMPUS", state: "ACTIVE", code: "SYNTHETIC", label: "Synthetic" }) },
    crmReferenceKey: { findMany: async () => [] },
    rolePermissionConfiguration: { findMany: async () => { order.push("permissions"); return []; } },
    telephonyCallEvent: { findFirst: async (query: { where: { idempotencyKey: string; eventType: string; state: string; actorId: string; call: { createdBy: string; provider: string; direction: string; leadId: null; purposeCode: { in: string[] }; agentCommand: { workstationId: string } } } }) => {
      order.push("receipt"); lastQuery = query; await beforeReceipt?.();
      const w = query.where; const c = w.call;
      return exists && receipt.idempotencyKey === w.idempotencyKey && receipt.eventType === w.eventType && receipt.state === w.state && receipt.actorId === w.actorId
        && call.createdBy === c.createdBy && call.provider === c.provider && call.direction === c.direction && call.leadId === c.leadId
        && c.purposeCode.in.includes(call.purposeCode) && call.agentCommand?.workstationId === c.agentCommand.workstationId ? { call: structuredClone(call) } : null;
    } },
    auditEvent: { upsert: async (query: { where: { idempotencyKey: string }; update: object; create: unknown }) => { order.push("audit"); if (auditFailure) throw new Error("synthetic-audit-unavailable"); assert.deepEqual(query.update, {}); if (!audits.has(query.where.idempotencyKey)) audits.set(query.where.idempotencyKey, query.create); return {}; } },
  };
  const client = { ...tx, $transaction: async (action: (transaction: typeof tx) => Promise<unknown>, options: unknown) => { assert.deepEqual(options, { isolationLevel: "ReadCommitted", timeout: 30_000, maxWait: 5_000 }); return action(tx); } };
  const repository = new TelephonyAgentRepository({ client } as unknown as PrismaService);
  const reconcile = () => repository.reconcileFreeCall({ ...identity, roles: [...user.roles], ...(user.campusId ? { campusId: user.campusId } : {}) }, { idempotencyKey: key });
  return { repository, reconcile, user, profile, workstation, command, call, receipt, audits, order, query: () => lastQuery,
    absent: () => { exists = false; }, failAudit: () => { auditFailure = true; }, beforeProfileLock: (fn: typeof beforeProfileLock) => { beforeProfileLock = fn; }, beforeReceipt: (fn: typeof beforeReceipt) => { beforeReceipt = fn; } };
}

test("reconciliation machine route authenticates before reading and has no dispatch dependency", async () => {
  const f = fixture();
  const controller = new TelephonyAgentController(f.repository, {} as TelephonyService, {} as DynamicPermissionRepository);
  assert.equal(Reflect.getMetadata("path", controller.reconcileFreeCall), "free-calls/reconciliation");
  assert.deepEqual(Reflect.getMetadata("__headers__", controller.reconcileFreeCall), [{ name: "Cache-Control", value: "no-store" }]);
  await assert.rejects(controller.reconcileFreeCall(undefined, { idempotencyKey: key }), code("telephony_agent_authentication_refused"));
  await assert.rejects(controller.reconcileFreeCall("invalid-machine-token-xxxxxxxxxxxxxxxxxxx", { idempotencyKey: key }), code("telephony_agent_authentication_refused"));
  assert.equal(f.query(), undefined);
  assert.equal((await controller.reconcileFreeCall(token, { idempotencyKey: key })).outcome, "PENDING");
});

test("strict request rejects extra authority fields, invalid keys and non-objects", async () => {
  const f = fixture();
  for (const body of [null, [], {}, { idempotencyKey: key, userId: identity.userId }, { idempotencyKey: key, workstationId: identity.workstationId }, { idempotencyKey: 1 }, { idempotencyKey: "short" }, { idempotencyKey: "x".repeat(129) }, { idempotencyKey: " spaced-key " }, { idempotencyKey: "line\nbreak" }]) {
    await assert.rejects(f.repository.reconcileFreeCall(identity, body), code("telephony_reconciliation_invalid"));
  }
  assert.equal(f.order.length, 0);
});

test("permission fence precedes profile lock, generation revalidation, permission and receipt", async () => {
  const f = fixture(); await f.reconcile();
  const index = (text: string) => f.order.findIndex(value => value.includes(text));
  assert.ok(index("pg_advisory_xact_lock_shared") < index("telephony_server_profiles"));
  assert.ok(index("telephony_server_profiles") < index("telephony_user_profiles"));
  assert.ok(index("telephony_user_profiles") < index("identity"));
  assert.ok(index("identity") < index("permissions"));
  assert.ok(index("permissions") < index("receipt"));
  const query = JSON.stringify(f.query());
  assert.ok(!query.includes("destination") && !query.includes("phone") && !query.includes("token"));
});

test("revocation and credential/role/campus generations changed while waiting are refused", async () => {
  const changes = [
    (f: ReturnType<typeof fixture>) => { f.workstation.active = false; },
    (f: ReturnType<typeof fixture>) => { f.workstation.tokenDigest = "new-generation"; },
    (f: ReturnType<typeof fixture>) => { f.user.authenticationVersion++; },
    (f: ReturnType<typeof fixture>) => { f.user.roles = ["ADMIN"]; },
    (f: ReturnType<typeof fixture>) => { f.user.campusId = "different-campus"; },
    (f: ReturnType<typeof fixture>) => { f.user.firstLoginRequired = true; },
    (f: ReturnType<typeof fixture>) => { f.user.active = false; },
    (f: ReturnType<typeof fixture>) => { f.profile.enabled = false; },
    (f: ReturnType<typeof fixture>) => { f.profile.serverProfile.enabled = false; },
    (f: ReturnType<typeof fixture>) => { f.workstation.userProfileId = "other-profile"; },
    (f: ReturnType<typeof fixture>) => { f.profile.userId = "other-owner"; },
  ];
  for (const change of changes) {
    const f = fixture(); f.beforeProfileLock(() => change(f));
    await assert.rejects(f.repository.reconcileFreeCall(identity, { idempotencyKey: key }), code("telephony_agent_authentication_refused"));
    assert.equal(f.query(), undefined); assert.equal(f.audits.size, 0);
  }
});

test("valid machine identity without free-call permission cannot inspect any receipt", async () => {
  const f = fixture(); f.user.roles = ["ADMISSIONS"]; f.user.campusId = "00000000-0000-4000-8000-000000000176";
  await assert.rejects(f.reconcile(), code("telephony_agent_command_scope_forbidden"));
  assert.equal(f.query(), undefined); assert.equal(f.audits.size, 0);
});

test("absence, another actor/poste, lead calls and non-request events disclose no call IDs", async () => {
  const changes = [
    (f: ReturnType<typeof fixture>) => f.absent(),
    (f: ReturnType<typeof fixture>) => { f.receipt.actorId = "other"; },
    (f: ReturnType<typeof fixture>) => { f.call.createdBy = "other"; },
    (f: ReturnType<typeof fixture>) => { f.command.workstationId = "other"; },
    (f: ReturnType<typeof fixture>) => { f.call.leadId = "lead"; },
    (f: ReturnType<typeof fixture>) => { f.call.provider = "MOCK"; },
    (f: ReturnType<typeof fixture>) => { f.call.direction = "INBOUND"; },
    (f: ReturnType<typeof fixture>) => { f.call.purposeCode = ""; },
    (f: ReturnType<typeof fixture>) => { f.receipt.state = "ENDED"; },
    (f: ReturnType<typeof fixture>) => { f.receipt.eventType = "COMPENSATION"; },
    (f: ReturnType<typeof fixture>) => { f.call.agentCommand = null; },
  ];
  for (const change of changes) {
    const f = fixture(); change(f);
    assert.deepEqual(await f.reconcile(), { idempotencyKey: key, workstationId: identity.workstationId, profileId: identity.profileId, outcome: "UNKNOWN" });
  }
});

test("only persistently terminal or never-delivered expired commands resolve an intent", async () => {
  const cases: [string, Date | null, Date | null, string, string][] = [
    ["PENDING", null, null, "REQUESTED", "PENDING"],
    ["PENDING", null, new Date(0), "REQUESTED", "UNCERTAIN"],
    ["DELIVERED", null, new Date(0), "ENDED", "UNCERTAIN"],
    ["UNCERTAIN", new Date(0), new Date(0), "ENDED", "UNCERTAIN"],
    ["TERMINAL", null, new Date(0), "ENDED", "UNCERTAIN"],
    ["TERMINAL", new Date(0), new Date(0), "ANSWERED", "UNCERTAIN"],
    ...["ENDED", "FAILED", "MISSED", "CANCELLED"].map(state => ["TERMINAL", new Date(0), new Date(0), state, "TERMINAL"] as [string, Date, Date, string, string]),
    ["EXPIRED", new Date(0), null, "REQUESTED", "EXPIRED_UNDELIVERED"],
    ["EXPIRED", null, null, "REQUESTED", "UNCERTAIN"],
    ["EXPIRED", new Date(0), new Date(0), "REQUESTED", "UNCERTAIN"],
    ["FUTURE_STATE", new Date(0), null, "ENDED", "UNCERTAIN"],
  ];
  for (const [state, terminalAt, claimedAt, callState, outcome] of cases) {
    const f = fixture(); Object.assign(f.command, { state, terminalAt, claimedAt }); f.call.state = callState;
    assert.deepEqual(await f.reconcile(), { idempotencyKey: key, workstationId: identity.workstationId, profileId: identity.profileId, outcome, commandId: f.call.externalId, callId: f.call.id });
  }
});

test("absence during in-flight creation stays UNKNOWN, later delivery stays unresolved", async () => {
  const f = fixture(); f.call.agentCommand = null;
  assert.equal((await f.reconcile()).outcome, "UNKNOWN");
  f.call.agentCommand = f.command; f.command.state = "DELIVERED"; f.command.claimedAt = new Date();
  assert.equal((await f.reconcile()).outcome, "UNCERTAIN");
  f.call.state = "ENDED";
  assert.equal((await f.reconcile()).outcome, "UNCERTAIN");
  f.command.state = "TERMINAL"; f.command.terminalAt = new Date();
  assert.equal((await f.reconcile()).outcome, "TERMINAL");
});

test("decision observes state after the profile lock, not a stale pre-lock snapshot", async () => {
  const f = fixture();
  f.beforeProfileLock(() => { f.command.state = "DELIVERED"; f.command.claimedAt = new Date(); });
  assert.equal((await f.reconcile()).outcome, "UNCERTAIN");
});

test("audit is idempotent per observed outcome and contains no phone, token or input key", async () => {
  const f = fixture(); await f.reconcile(); await f.reconcile(); assert.equal(f.audits.size, 1);
  f.command.state = "DELIVERED"; f.command.claimedAt = new Date(); await f.reconcile(); await f.reconcile(); assert.equal(f.audits.size, 2);
  const serialized = JSON.stringify([...f.audits.values()]);
  for (const secret of [key, token, identity.tokenDigest, "destination", "phone"]) assert.ok(!serialized.includes(secret));
});

test("unavailable persistence or audit never produces a successful resolving response", async () => {
  const repository = new TelephonyAgentRepository({ client: undefined } as unknown as PrismaService);
  await assert.rejects(repository.reconcileFreeCall(identity, { idempotencyKey: key }), code("telephony_persistence_required"));
  const f = fixture(); f.command.state = "TERMINAL"; f.command.terminalAt = new Date(); f.call.state = "ENDED"; f.failAudit();
  await assert.rejects(f.reconcile(), /synthetic-audit-unavailable/);
  assert.equal(f.audits.size, 0);
});
