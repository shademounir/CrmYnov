import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";
import type { ExecutionContext, HttpException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AccessRecoveryService, RECOVERY_ACCEPTED, RECOVERY_ACKNOWLEDGEMENT_MS } from "../src/access-recovery/access-recovery.service.js";
import { AccessRecoveryRateLimitGuard } from "../src/access-recovery/access-recovery-rate-limit.guard.js";
import { deriveSecret, digestRecoveryValue, LocalCredentialAdapter, LocalIdentityDirectory, LocalRecoveryChallengeStore } from "../src/access-recovery/access-recovery.store.js";
import { RateLimitService } from "../src/auth/rate-limit.service.js";
import type { PrismaService } from "../src/persistence/prisma.service.js";
import type { DynamicPermissionRepository, PermissionTransaction } from "../src/permissions/dynamic-repository.js";
import type { GmailInvitationSender, InvitationDelivery } from "../src/invitations/gmail-invitation.sender.js";

type Row = Record<string, unknown>;
type Tables = "collaborator" | "localPasswordHash" | "localRecoveryChallenge" | "localSession" | "localAccessInvitation" | "auditEvent";
type State = Record<Tables, Row[]>;
interface TableDelegate {
  count(input: { where: Row }): Promise<number>;
  findUnique(input: { where: Row }): Promise<Row | null>;
  create(input: { data: Row }): Promise<Row>;
  updateMany(input: { where: Row; data: Row }): Promise<{ count: number }>;
  update(input: { where: Row; data: Row }): Promise<Row>;
}
class FastRecovery extends AccessRecoveryService {
  deadlines: number[] = [];
  protected override waitForAcknowledgement(deadline: number): Promise<void> { this.deadlines.push(deadline); return Promise.resolve(); }
}
interface RecoveryFixture {
  userId: string;
  state(): State;
  service(): FastRecovery;
  deliveries: InvitationDelivery[];
  token(): string;
  failEvent(value: string): void;
  deliveryFailure(): void;
}
const path = "/access-recovery/complete";
const email = "activated@example.invalid";
const nextSecret = "Synthetic-Reset-2026!";
let previousEnabled: string | undefined;
beforeEach(() => { previousEnabled = process.env.CRM_ACCESS_RECOVERY_ENABLED; process.env.CRM_ACCESS_RECOVERY_ENABLED = "true"; });
afterEach(() => { if (previousEnabled === undefined) delete process.env.CRM_ACCESS_RECOVERY_ENABLED; else process.env.CRM_ACCESS_RECOVERY_ENABLED = previousEnabled; });
function hasCode(code: string): (error: unknown) => boolean {
  return (error) => (error as HttpException).getResponse?.() !== null
    && ((error as HttpException).getResponse?.() as { code?: string })?.code === code;
}
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      const options = expected as Row;
      if ("gt" in options) return Number(actual) > Number(options.gt);
      if ("in" in options) return (options.in as unknown[]).includes(actual);
    }
    return actual === expected;
  });
}
function fixture(): RecoveryFixture {
  const userId = randomUUID();
  let state: State = {
    collaborator: [{ id: userId, professionalEmail: email, active: true, firstLoginRequired: false, authenticationVersion: 4, roles: ["ADMISSIONS"], campusId: randomUUID() }],
    localPasswordHash: [{ collaboratorId: userId, identityDigest: digestRecoveryValue(email), passwordSalt: "synthetic-old-salt", passwordDigest: deriveSecret("Synthetic-Old-2026!", "synthetic-old-salt"), mustChange: false }],
    localRecoveryChallenge: [],
    localSession: [{ id: randomUUID(), collaboratorId: userId, active: true, authenticationVersion: 4, revokedAt: null }],
    localAccessInvitation: [{ id: randomUUID(), collaboratorId: userId, state: "SENT" }],
    auditEvent: [],
  };
  let failEvent: string | undefined;
  const delegate = (table: Tables): TableDelegate => ({
    count: ({ where }: { where: Row }): Promise<number> => Promise.resolve(state[table].filter((row) => matches(row, where)).length),
    findUnique: ({ where }: { where: Row }): Promise<Row | null> => {
      const row = state[table].find((item) => matches(item, where));
      return Promise.resolve(row && table === "collaborator" ? { ...row, passwordHash: state.localPasswordHash.find((item) => item.collaboratorId === row.id) ?? null } : row ?? null);
    },
    create: ({ data }: { data: Row }): Promise<Row> => {
      if (table === "auditEvent" && data.eventType === failEvent) throw new Error("synthetic audit failure");
      if (table === "auditEvent" && state.auditEvent.some((row) => row.idempotencyKey === data.idempotencyKey)) throw new Error("synthetic unique violation");
      const row = { id: randomUUID(), createdAt: new Date(), occurredAt: new Date(), usedAt: null, ...data };
      state[table].push(row);
      return Promise.resolve(row);
    },
    updateMany: ({ where, data }: { where: Row; data: Row }): Promise<{ count: number }> => {
      const rows = state[table].filter((row) => matches(row, where));
      for (const row of rows) for (const [key, value] of Object.entries(data)) {
        row[key] = value && typeof value === "object" && "increment" in value ? Number(row[key]) + Number(value.increment) : value;
      }
      return Promise.resolve({ count: rows.length });
    },
    update: ({ where, data }: { where: Row; data: Row }): Promise<Row> => {
      const row = state[table].find((item) => matches(item, where));
      assert.ok(row);
      Object.assign(row, data);
      return Promise.resolve(row);
    },
  });
  const tx = Object.fromEntries(Object.keys(state).map((name) => [name, delegate(name as Tables)])) as unknown as PermissionTransaction;
  let chain: Promise<unknown> = Promise.resolve();
  const permissions = { transaction: <T>(action: (transaction: PermissionTransaction) => Promise<T>): Promise<T> => {
    const operation = chain.then(async () => {
      const snapshot = structuredClone(state);
      try { return await action(tx); } catch (error) { state = snapshot; throw error; }
    });
    chain = operation.catch(() => undefined);
    return operation;
  } } as unknown as DynamicPermissionRepository;
  const deliveries: InvitationDelivery[] = [];
  let deliveryFailure = false;
  const sender = { configured: () => true, publicOrigin: () => "https://dev.example.invalid", send: (delivery: InvitationDelivery): Promise<void> => {
    deliveries.push(delivery);
    return deliveryFailure ? Promise.reject(new Error("synthetic private provider detail")) : Promise.resolve();
  } } as unknown as GmailInvitationSender;
  const service = (): FastRecovery => new FastRecovery(new LocalIdentityDirectory(), new LocalRecoveryChallengeStore(), new LocalCredentialAdapter(), new RateLimitService(), { client: tx } as unknown as PrismaService, permissions, sender);
  const token = (): string => {
    const value = new URLSearchParams(new URL(deliveries.at(-1)!.link).hash.slice(1)).get("token");
    assert.ok(value);
    return value;
  };
  return { userId, state: (): State => state, service, deliveries, token, failEvent: (value: string): void => { failEvent = value; }, deliveryFailure: (): void => { deliveryFailure = true; } };
}

test("explicitly enabled persistent requests read current eligibility and return the same padded acknowledgement", async () => {
  const f = fixture(), service = f.service(), before = Date.now();
  assert.deepEqual(await service.requestForApi(email.toUpperCase(), path), RECOVERY_ACCEPTED);
  assert.deepEqual(await service.requestForApi("absent@example.invalid", path), RECOVERY_ACCEPTED);
  f.state().collaborator[0]!.firstLoginRequired = true;
  assert.deepEqual(await service.requestForApi(email, path), RECOVERY_ACCEPTED);
  assert.equal(f.deliveries.length, 1);
  assert.equal(f.deliveries[0]!.purpose, "RECOVERY");
  assert.equal(new URL(f.deliveries[0]!.link).protocol, "https:");
  assert.equal(new URL(f.deliveries[0]!.link).search, "");
  assert.match(f.token(), /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(service.deadlines.length, 3);
  assert.ok(service.deadlines.every((deadline) => deadline >= before + RECOVERY_ACKNOWLEDGEMENT_MS));
  const stored = JSON.stringify(f.state().localRecoveryChallenge) + JSON.stringify(f.state().auditEvent);
  assert.ok(!stored.includes(f.token()) && !stored.includes(email));
  const requested = f.state().auditEvent.find((row) => row.eventType === "ACCESS_RECOVERY_REQUESTED")!;
  assert.deepEqual(requested.after, { challengeId: f.state().localRecoveryChallenge[0]!.id, authenticationVersion: 4 });
});

test("recovery is fail-closed unless explicitly true, preserving existing challenges, credentials, sessions and audit quotas", async () => {
  const f = fixture(), service = f.service();
  await service.requestForApi(email, path);
  const token = f.token(), before = structuredClone(f.state()), deliveries = f.deliveries.length, deadlines = service.deadlines.length;
  for (const value of [undefined, "false", "TRUE", "1", " true "]) {
    if (value === undefined) delete process.env.CRM_ACCESS_RECOVERY_ENABLED;
    else process.env.CRM_ACCESS_RECOVERY_ENABLED = value;
    await assert.rejects(service.requestForApi(email, path), hasCode("recovery_disabled"));
    await assert.rejects(service.completeForApi(token, path, nextSecret), hasCode("recovery_disabled"));
    await assert.rejects(service.assertClientAllowedForApi("REQUEST", "127.0.0.1"), hasCode("recovery_disabled"));
    assert.deepEqual(f.state(), before);
    assert.equal(f.deliveries.length, deliveries);
    assert.equal(service.deadlines.length, deadlines, "disabled infrastructure has no eligibility-dependent acknowledgement work");
  }
  process.env.CRM_ACCESS_RECOVERY_ENABLED = "true";
  await service.completeForApi(token, path, nextSecret);
  assert.equal(f.state().collaborator[0]!.authenticationVersion, 5);
});

test("inactive, must-change and missing hash subjects remain silent and account issuance is bounded", async () => {
  for (const mutation of [(f: RecoveryFixture): void => { f.state().collaborator[0]!.active = false; }, (f: RecoveryFixture): void => { f.state().localPasswordHash[0]!.mustChange = true; }, (f: RecoveryFixture): void => { f.state().localPasswordHash.length = 0; }]) {
    const f = fixture(); mutation(f);
    assert.deepEqual(await f.service().requestForApi(email, path), RECOVERY_ACCEPTED);
    assert.equal(f.deliveries.length, 0);
  }
  const f = fixture(), instances = [f.service(), f.service()];
  for (let index = 0; index < 4; index++) assert.deepEqual(await instances[index % 2]!.requestForApi(email, path), RECOVERY_ACCEPTED);
  assert.equal(f.deliveries.length, 3);
  assert.equal(f.state().localRecoveryChallenge.length, 3);
  assert.equal(f.state().localRecoveryChallenge.filter((row) => row.usedAt === null).length, 1);
});

test("delivery uncertainty invalidates the challenge without retry or leaking provider details", async () => {
  const f = fixture(); f.deliveryFailure();
  assert.deepEqual(await f.service().requestForApi(email, path), RECOVERY_ACCEPTED);
  assert.equal(f.deliveries.length, 1);
  assert.ok(f.state().localRecoveryChallenge[0]!.usedAt);
  assert.equal(f.state().auditEvent.filter((row) => row.eventType === "ACCESS_RECOVERY_DELIVERY_UNCONFIRMED").length, 1);
  await assert.rejects(f.service().completeForApi(f.token(), path, nextSecret), hasCode("recovery_challenge_invalid"));
  assert.ok(!JSON.stringify(f.state().auditEvent).includes("private provider"));
});

test("completion atomically claims the token and version, changes only hashes and revokes sessions and outstanding credentials", async () => {
  const f = fixture(), a = f.service(), b = f.service();
  await a.requestForApi(email, path);
  const raw = f.token(), initialDigest = f.state().localPasswordHash[0]!.passwordDigest;
  f.state().localRecoveryChallenge.push({ id: randomUUID(), collaboratorId: f.userId, usedAt: null, expiresAt: new Date(Date.now() + 60_000), tokenDigest: "synthetic-other", returnPath: path });
  const results = await Promise.allSettled([a.completeForApi(raw, path, nextSecret), b.completeForApi(raw, path, nextSecret)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(f.state().collaborator[0]!.authenticationVersion, 5);
  const credential = f.state().localPasswordHash[0]!;
  assert.notEqual(credential.passwordDigest, initialDigest);
  assert.equal(credential.passwordDigest, deriveSecret(nextSecret, credential.passwordSalt as string));
  assert.equal(f.state().localSession[0]!.active, false);
  assert.ok(f.state().localSession[0]!.revokedAt);
  assert.equal(f.state().localAccessInvitation[0]!.state, "REVOKED");
  assert.ok(f.state().localRecoveryChallenge.every((row) => row.usedAt !== null));
  assert.equal(f.state().auditEvent.filter((row) => row.eventType === "ACCESS_RECOVERY_COMPLETED").length, 1);
  assert.ok(!JSON.stringify(f.state()).includes(raw) && !JSON.stringify(f.state()).includes(nextSecret));
});

test("a completion rollback keeps the token, hash, auth version and sessions intact while the prior guard attempt persists", async () => {
  const f = fixture(), service = f.service();
  await service.requestForApi(email, path);
  await service.assertClientAllowedForApi("COMPLETION", "127.0.0.1");
  const before = structuredClone(f.state()); f.failEvent("ACCESS_RECOVERY_COMPLETED");
  await assert.rejects(service.completeForApi(f.token(), path, nextSecret), /synthetic audit failure/u);
  assert.deepEqual(f.state(), before);
  assert.equal(f.state().auditEvent.filter((row) => row.eventType === "ACCESS_RECOVERY_COMPLETION_ATTEMPT").length, 1);
});

test("stale auth versions, revoked eligibility, missing request audits and expired tokens are refused without mutation", async () => {
  const mutations = [
    (f: RecoveryFixture): void => { f.state().collaborator[0]!.authenticationVersion = 5; },
    (f: RecoveryFixture): void => { f.state().collaborator[0]!.active = false; },
    (f: RecoveryFixture): void => { f.state().collaborator[0]!.firstLoginRequired = true; },
    (f: RecoveryFixture): void => { f.state().localPasswordHash[0]!.mustChange = true; },
    (f: RecoveryFixture): void => { f.state().auditEvent.length = 0; },
    (f: RecoveryFixture): void => { f.state().localRecoveryChallenge[0]!.expiresAt = new Date(0); },
    (f: RecoveryFixture): void => { f.state().auditEvent[0]!.after = { challengeId: "other", authenticationVersion: 4 }; },
  ];
  for (const mutate of mutations) {
    const f = fixture(), service = f.service(); await service.requestForApi(email, path); mutate(f);
    const before = structuredClone(f.state());
    await assert.rejects(service.completeForApi(f.token(), path, nextSecret), hasCode("recovery_challenge_invalid"));
    assert.deepEqual(f.state(), before);
  }
});

test("persistent request syntax and password policy fail closed without a legacy fallback", async () => {
  const f = fixture(), service = f.service();
  for (const value of [undefined, "invalid", "x".repeat(255) + "@example.invalid"]) await assert.rejects(service.requestForApi(value, path), hasCode("recovery_request_invalid"));
  await assert.rejects(service.requestForApi(email, "https://outside.invalid"), hasCode("recovery_return_path_invalid"));
  for (const value of ["short", "nocapital-2026!", "NOLOWERCASE-2026!", "MissingSymbols2026", "Synthetic-Reset-2026! ", "a".repeat(129)]) await assert.rejects(service.completeForApi("a".repeat(43), path, value), hasCode("recovery_completion_invalid"));
  await assert.rejects(service.completeForApi("a".repeat(43), "https://outside.invalid", nextSecret), hasCode("recovery_return_path_invalid"));
  const noStore = new AccessRecoveryService(new LocalIdentityDirectory(), new LocalRecoveryChallengeStore(), new LocalCredentialAdapter(), new RateLimitService());
  await assert.rejects(noStore.completeForApi("a".repeat(43), path, nextSecret), hasCode("recovery_store_unavailable"));
  assert.equal(f.deliveries.length, 0);
});

test("client quotas are shared across instances, do not store raw addresses and expire at the minute boundary", async () => {
  const f = fixture(), a = f.service(), b = f.service(), now = Date.now();
  for (let index = 0; index < 5; index++) await (index % 2 ? a : b).assertClientAllowedForApi("REQUEST", "192.0.2.1", now);
  await assert.rejects(b.assertClientAllowedForApi("REQUEST", "192.0.2.1", now + 1), hasCode("rate_limit_exceeded"));
  assert.equal(f.state().auditEvent.length, 5);
  assert.ok(!JSON.stringify(f.state().auditEvent).includes("192.0.2.1"));
  await b.assertClientAllowedForApi("REQUEST", "192.0.2.1", now + 60_000);
  await b.assertClientAllowedForApi("COMPLETION", "192.0.2.1", now);
});

test("the HTTP guard uses the server-observed address, not forwarded headers or request payloads", async () => {
  const calls: unknown[][] = [];
  const guard = new AccessRecoveryRateLimitGuard({ assertClientAllowedForApi: (...args: unknown[]) => { calls.push(args); return Promise.resolve(); } } as unknown as AccessRecoveryService);
  const context = (handler: string, request: object): ExecutionContext => ({ getHandler: () => ({ name: handler }), switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;
  assert.equal(await guard.canActivate(context("request", { ip: "127.0.0.1", headers: { "x-forwarded-for": "forged" }, body: { ip: "forged" } })), true);
  assert.equal(await guard.canActivate(context("complete", {})), true);
  assert.deepEqual(calls, [["REQUEST", "127.0.0.1"], ["COMPLETION", "unknown"]]);
  await assert.rejects(guard.canActivate(context("unknown", {})), hasCode("recovery_operation_unavailable"));
});
