import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import type { AuditEvent } from "@prisma/client";
import { createApplication } from "../../src/application.js";
import { PrismaService } from "../../src/persistence/prisma.service.js";
import { GmailInvitationSender } from "../../src/invitations/gmail-invitation.sender.js";
import { deriveSecret, digestRecoveryValue } from "../../src/access-recovery/access-recovery.store.js";
import { RECOVERY_ACCEPTED } from "../../src/access-recovery/access-recovery.service.js";

const options = { skip: process.env.CRMY161_RECOVERY_EPHEMERAL_TEST !== "true", timeout: 300_000 };
const returnPath = "/access-recovery/complete";
const nextSecret = "Synthetic-Recovery-2026!";
type Result<T = { code?: string }> = { status: number; body: T; setCookie: string[] | undefined };
type Actor = { id: string; email: string; password: string };
type Session = { token: string; mustChangeSecret: boolean };

test("CRMY-161 recovery is fenced, single-use and versioned across two real PostgreSQL API instances", options, async (context) => {
  // Refuse every persistent preview/cloud connection before the first fixture write.
  assert.equal(process.env.CRMY161_RECOVERY_EPHEMERAL_TEST, "true");
  assert.equal(process.env.SHEETS_ENABLED, "false");
  assert.equal(process.env.CRM_BACKGROUND_WORKERS, "external");
  assert.equal(process.env.CRM_ACCESS_RECOVERY_ENABLED, "true", "the isolated runner explicitly enables the coherent API/Web feature contract");
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.protocol, "postgresql:"); assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/crmy161_recovery_synthetic"); assert.equal(url.username, "postgres");
  assert.equal(url.password, ""); assert.equal(url.search, ""); assert.equal(url.hash, "");
  assert.match(url.port, /^\d+$/u);
  const nonce = process.env.CRMY161_RECOVERY_DATABASE_NONCE;
  assert.match(nonce ?? "", /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u);
  const prisma = new PrismaService(), db = prisma.client;
  assert.ok(db);
  const apps: INestApplication[] = [];
  const delivered = new Map<string, string[]>();
  const failedRecipients = new Set<string>();
  try {
    assert.deepEqual(await db.$queryRaw<Array<{ nonce: string }>>`SELECT nonce FROM crmy161_recovery_test_identity.marker`, [{ nonce }]);
    const suffix = randomUUID().slice(0, 8);
    const campus = await db.crmReference.create({ data: { kind: "CAMPUS", code: `RECOVERY-${suffix}`, label: `Synthetic recovery ${suffix}`, scope: "GLOBAL", scopeKey: "GLOBAL" } });
    const actor = async (label: string): Promise<Actor> => {
      const email = `recovery-${label}-${suffix}@example.invalid`, password = `Synthetic-${randomBytes(12).toString("hex")}-2026!`, salt = randomBytes(16).toString("hex");
      const user = await db.collaborator.create({ data: { professionalEmail: email, roles: ["ADMISSIONS"], campusId: campus.id, active: true, firstLoginRequired: false, authenticationVersion: 4 } });
      await db.localPasswordHash.create({ data: { collaboratorId: user.id, identityDigest: digestRecoveryValue(email), passwordSalt: salt, passwordDigest: deriveSecret(password, salt), mustChange: false } });
      return { id: user.id, email, password };
    };
    const positive = await actor("positive"), quotaSubject = await actor("quota"), rollback = await actor("rollback"), uncertain = await actor("uncertain");
    const rejected = await Promise.all(["version", "inactive", "first-login", "must-change", "expired", "legacy"].map(actor));
    for (let index = 0; index < 2; index++) {
      const app = await createApplication(); apps.push(app);
      const sender = app.get(GmailInvitationSender);
      sender.configured = (): boolean => true;
      sender.publicOrigin = (): string => "https://recovery.example.invalid";
      sender.send = ({ recipient, link, purpose, signal }): Promise<void> => {
        assert.equal(purpose, "RECOVERY"); assert.ok(signal);
        delivered.set(recipient, [...(delivered.get(recipient) ?? []), link]);
        return failedRecipients.has(recipient) ? Promise.reject(new Error("synthetic transport failure")) : Promise.resolve();
      };
      await app.listen(0, "127.0.0.1");
    }
    const ports = apps.map((app) => (app.getHttpServer().address() as AddressInfo).port);
    // Distinct synthetic clients use actual loopback source addresses, not forged headers.
    // The dedicated quota cases use the same source on both API instances.
    const http = <T = { code?: string }>(instance: number, method: string, path: string, body?: unknown, token?: string, source = "127.0.0.1"): Promise<Result<T>> => new Promise((resolve, reject) => {
      assert.match(source, /^127\.0\.0\.(?:[1-9]|[1-9]\d)$/u);
      const encoded = body === undefined ? undefined : JSON.stringify(body);
      const request = httpRequest({ hostname: "127.0.0.1", port: ports[instance], path, method, localAddress: source,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(encoded === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(encoded) }) } }, (response) => {
        let text = "";
        response.setEncoding("utf8"); response.on("data", (chunk: string) => { text += chunk; });
        response.on("end", () => {
          try { resolve({ status: response.statusCode ?? 0, body: (text ? JSON.parse(text) : null) as T, setCookie: response.headers["set-cookie"] }); }
          catch (error) { reject(error instanceof Error ? error : new Error("synthetic response parse failure")); }
        });
      });
      request.setTimeout(35_000, () => request.destroy(new Error("synthetic HTTP timeout")));
      request.on("error", reject); if (encoded !== undefined) request.write(encoded); request.end();
    });
    const requestRecovery = (subject: Actor, source: string, instance = 0): Promise<Result<typeof RECOVERY_ACCEPTED>> => http(instance, "POST", "/access-recovery/requests", { email: subject.email, returnPath }, undefined, source);
    const rawToken = (subject: Actor): string => {
      const link = delivered.get(subject.email)?.at(-1); assert.ok(link);
      const parsed = new URL(link); assert.equal(parsed.protocol, "https:"); assert.equal(parsed.search, "");
      assert.equal(parsed.pathname, returnPath);
      const token = new URLSearchParams(parsed.hash.slice(1)).get("token"); assert.match(token ?? "", /^[A-Za-z0-9_-]{43}$/u);
      return token!;
    };
    const effects = async (subject: Actor): Promise<object> => ({
      user: await db.collaborator.findUnique({ where: { id: subject.id } }),
      hash: await db.localPasswordHash.findUnique({ where: { collaboratorId: subject.id } }),
      sessions: await db.localSession.findMany({ where: { collaboratorId: subject.id }, orderBy: { id: "asc" } }),
      challenges: await db.localRecoveryChallenge.findMany({ where: { collaboratorId: subject.id }, orderBy: { id: "asc" } }),
      invitations: await db.localAccessInvitation.findMany({ where: { collaboratorId: subject.id }, orderBy: { id: "asc" } }),
      audits: await db.auditEvent.findMany({ where: { resourceId: subject.id }, orderBy: { id: "asc" } }),
    });
    const staggered = async <T>(actions: Array<() => Promise<T>>): Promise<T[]> => {
      const pending: Array<Promise<T>> = [];
      for (const action of actions) { pending.push(action()); await new Promise<void>((resolve) => setTimeout(resolve, 150)); }
      return Promise.all(pending);
    };

    await context.test("disabled recovery refuses both anonymous routes before mail, challenges, quota audits or identity mutations", async () => {
      const before = await effects(positive), auditsBefore = await db.auditEvent.count();
      const configured = process.env.CRM_ACCESS_RECOVERY_ENABLED;
      try {
        for (const value of [undefined, "false"]) {
          if (value === undefined) delete process.env.CRM_ACCESS_RECOVERY_ENABLED; else process.env.CRM_ACCESS_RECOVERY_ENABLED = value;
          const request = await requestRecovery(positive, "127.0.0.3");
          const completion = await http(1, "POST", "/access-recovery/completions", { token: "a".repeat(43), returnPath, nextSecret }, undefined, "127.0.0.3");
          assert.equal(request.status, 503); assert.deepEqual(request.body, { code: "recovery_disabled" });
          assert.equal(completion.status, 503); assert.deepEqual(completion.body, { code: "recovery_disabled" });
          assert.deepEqual(await effects(positive), before);
          assert.equal(await db.auditEvent.count(), auditsBefore);
          assert.equal(delivered.size, 0);
        }
      } finally { if (configured === undefined) delete process.env.CRM_ACCESS_RECOVERY_ENABLED; else process.env.CRM_ACCESS_RECOVERY_ENABLED = configured; }
    });

    await context.test("request audit binds a hash-only token to its auth version; exactly one concurrent completion succeeds and no session is created", async () => {
      const original = await http<Session>(0, "POST", "/sessions", { email: positive.email, password: positive.password });
      assert.equal(original.status, 201);
      const before = Date.now(), accepted = await requestRecovery(positive, "127.0.0.2");
      assert.equal(accepted.status, 202); assert.deepEqual(accepted.body, RECOVERY_ACCEPTED);
      assert.ok(Date.now() - before >= 14_900, "the real common acknowledgement window is not replaced by a test mock");
      const raw = rawToken(positive), challenge = await db.localRecoveryChallenge.findUniqueOrThrow({ where: { tokenDigest: digestRecoveryValue(raw) } });
      assert.notEqual(challenge.tokenDigest, raw); assert.equal(challenge.usedAt, null);
      const issued = await db.auditEvent.findUniqueOrThrow({ where: { idempotencyKey: `access-recovery-requested:${challenge.id}` } });
      assert.deepEqual(issued.after, { challengeId: challenge.id, authenticationVersion: 4 });
      assert.ok(!JSON.stringify(issued).includes(raw) && !JSON.stringify(issued).includes(positive.email));
      await db.localRecoveryChallenge.create({ data: { collaboratorId: positive.id, tokenDigest: digestRecoveryValue(randomBytes(32).toString("base64url")), returnPath, expiresAt: new Date(Date.now() + 60_000) } });
      await db.localAccessInvitation.create({ data: { collaboratorId: positive.id, linkDigest: digestRecoveryValue(randomBytes(32).toString("base64url")), state: "SENT", expiresAt: new Date(Date.now() + 60_000) } });
      const completions = await Promise.all([http(0, "POST", "/access-recovery/completions", { token: raw, returnPath, nextSecret }, undefined, "127.0.0.2"), http(1, "POST", "/access-recovery/completions", { token: raw, returnPath, nextSecret }, undefined, "127.0.0.2")]);
      assert.equal(completions.filter((result) => result.status === 204).length, 1);
      assert.ok(completions.filter((result) => result.status !== 204).every((result) => [403, 409].includes(result.status)));
      assert.ok(completions.every((result) => result.setCookie === undefined));
      assert.equal((await db.collaborator.findUniqueOrThrow({ where: { id: positive.id } })).authenticationVersion, 5);
      assert.equal(await db.localSession.count({ where: { collaboratorId: positive.id, active: true } }), 0);
      assert.equal(await db.localRecoveryChallenge.count({ where: { collaboratorId: positive.id, usedAt: null } }), 0);
      assert.equal(await db.localAccessInvitation.count({ where: { collaboratorId: positive.id, state: "SENT" } }), 0);
      assert.equal(await db.auditEvent.count({ where: { eventType: "ACCESS_RECOVERY_COMPLETED", resourceId: positive.id } }), 1);
      const stable = await effects(positive);
      assert.equal((await http(1, "POST", "/access-recovery/completions", { token: raw, returnPath, nextSecret }, undefined, "127.0.0.2")).status, 403);
      assert.deepEqual(await effects(positive), stable);
      for (let instance = 0; instance < 2; instance++) assert.equal((await http(instance, "GET", "/sessions/current", undefined, original.body.token)).status, 401);
      assert.equal((await http(1, "POST", "/sessions", { email: positive.email, password: positive.password })).status, 403);
      assert.equal((await http<Session>(1, "POST", "/sessions", { email: positive.email, password: nextSecret })).status, 201);
    });

    await context.test("current activation/version and emitted immutable audit are required, not stale startup caches or legacy tokens", async () => {
      const responses = await staggered(rejected.slice(0, 5).map((subject, index) => (): Promise<Result<typeof RECOVERY_ACCEPTED>> => requestRecovery(subject, `127.0.0.${10 + index}`, index % 2)));
      assert.ok(responses.every((response) => response.status === 202 && JSON.stringify(response.body) === JSON.stringify(RECOVERY_ACCEPTED)));
      const legacy = rejected[5]!;
      const legacyRaw = randomBytes(32).toString("base64url");
      await db.localRecoveryChallenge.create({ data: { collaboratorId: legacy.id, tokenDigest: digestRecoveryValue(legacyRaw), returnPath, expiresAt: new Date(Date.now() + 60_000) } });
      await db.collaborator.update({ where: { id: rejected[0]!.id }, data: { authenticationVersion: { increment: 1 } } });
      await db.collaborator.update({ where: { id: rejected[1]!.id }, data: { active: false } });
      await db.collaborator.update({ where: { id: rejected[2]!.id }, data: { firstLoginRequired: true } });
      await db.localPasswordHash.update({ where: { collaboratorId: rejected[3]!.id }, data: { mustChange: true } });
      await db.localRecoveryChallenge.updateMany({ where: { collaboratorId: rejected[4]!.id }, data: { expiresAt: new Date(0) } });
      for (let index = 0; index < rejected.length; index++) {
        const subject = rejected[index]!, before = await effects(subject), token = index === 5 ? legacyRaw : rawToken(subject);
        const refused = await http(index % 2, "POST", "/access-recovery/completions", { token, returnPath, nextSecret }, undefined, `127.0.0.${10 + index}`);
        assert.equal(refused.status, 403); assert.deepEqual(refused.body, { code: "recovery_challenge_invalid" });
        assert.deepEqual(await effects(subject), before);
      }
      const beforeSilent = await effects(rejected[1]!);
      const silent = await requestRecovery(rejected[1]!, "127.0.0.11", 1);
      assert.equal(silent.status, 202); assert.deepEqual(silent.body, RECOVERY_ACCEPTED);
      assert.deepEqual(await effects(rejected[1]!), beforeSilent);
    });

    await context.test("durable per-client guard quotas survive refused business transactions and account issuance stays bounded across instances", async () => {
      const account = await staggered(Array.from({ length: 4 }, (_, index) => (): Promise<Result<typeof RECOVERY_ACCEPTED>> => requestRecovery(quotaSubject, "127.0.0.30", index % 2)));
      assert.ok(account.every((response) => response.status === 202));
      assert.equal(delivered.get(quotaSubject.email)?.length, 3);
      assert.equal(await db.localRecoveryChallenge.count({ where: { collaboratorId: quotaSubject.id } }), 3);
      assert.equal(await db.localRecoveryChallenge.count({ where: { collaboratorId: quotaSubject.id, usedAt: null } }), 1);
      const unknown = { id: randomUUID(), email: `unknown-${suffix}@example.invalid`, password: "unused" };
      const limited = await staggered(Array.from({ length: 6 }, (_, index) => (): Promise<Result<typeof RECOVERY_ACCEPTED>> => requestRecovery(unknown, "127.0.0.40", index % 2)));
      assert.deepEqual(limited.map((response) => response.status), [202, 202, 202, 202, 202, 429]);
      assert.ok(limited.slice(0, 5).every((response) => JSON.stringify(response.body) === JSON.stringify(RECOVERY_ACCEPTED)));
      for (let index = 0; index < 6; index++) {
        const refused = await http(index % 2, "POST", "/access-recovery/completions", { token: "a".repeat(43), returnPath, nextSecret }, undefined, "127.0.0.41");
        assert.equal(refused.status, index < 5 ? 403 : 429);
      }
      for (const [operation, source] of [["REQUEST", "127.0.0.40"], ["COMPLETION", "127.0.0.41"]]) {
        const audits: AuditEvent[] = await db.auditEvent.findMany({ where: { eventType: `ACCESS_RECOVERY_${operation}_ATTEMPT`, resourceId: digestRecoveryValue(`crmy161-access-recovery-client:${source}`) } });
        assert.equal(audits.length, 5); assert.ok(!JSON.stringify(audits).includes(source!));
      }
    });

    await context.test("audit failure rolls back password/version/claims/revocations, while delivery uncertainty is invalidated without resend", async () => {
      const accepted = await requestRecovery(rollback, "127.0.0.50"); assert.equal(accepted.status, 202);
      const raw = rawToken(rollback), before = await effects(rollback), trigger = `crmy161_recovery_fault_${suffix}`;
      assert.match(trigger, /^crmy161_recovery_fault_[0-9a-f]{8}$/u);
      assert.match(rollback.id, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u);
      // Static event allowlist and generated identifier; nonce guard already proved ownership.
      await db.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type = 'ACCESS_RECOVERY_COMPLETED' AND NEW.resource_id = '${rollback.id}' THEN RAISE EXCEPTION 'synthetic_recovery_audit_failure'; END IF; RETURN NEW; END; $$`);
      try {
        await db.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
        try {
          assert.equal((await http(1, "POST", "/access-recovery/completions", { token: raw, returnPath, nextSecret }, undefined, "127.0.0.50")).status, 503);
          assert.deepEqual(await effects(rollback), before);
          assert.equal(await db.auditEvent.count({ where: { eventType: "ACCESS_RECOVERY_COMPLETION_ATTEMPT", resourceId: digestRecoveryValue("crmy161-access-recovery-client:127.0.0.50") } }), 1);
        } finally { await db.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON audit_events`); }
      } finally { await db.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`); }
      assert.equal((await http(0, "POST", "/access-recovery/completions", { token: raw, returnPath, nextSecret }, undefined, "127.0.0.50")).status, 204);
      failedRecipients.add(uncertain.email);
      const unconfirmed = await requestRecovery(uncertain, "127.0.0.51", 1);
      assert.equal(unconfirmed.status, 202); assert.deepEqual(unconfirmed.body, RECOVERY_ACCEPTED);
      assert.equal(delivered.get(uncertain.email)?.length, 1, "no automatic resend occurs");
      const failed = await db.localRecoveryChallenge.findFirstOrThrow({ where: { collaboratorId: uncertain.id } });
      assert.ok(failed.usedAt);
      assert.equal(await db.auditEvent.count({ where: { eventType: "ACCESS_RECOVERY_DELIVERY_UNCONFIRMED", resourceId: failed.id } }), 1);
      assert.equal((await http(0, "POST", "/access-recovery/completions", { token: rawToken(uncertain), returnPath, nextSecret }, undefined, "127.0.0.51")).status, 403);
      assert.equal(await db.auditEvent.count({ where: { eventType: "ACCESS_RECOVERY_COMPLETED", resourceId: uncertain.id } }), 0);
    });
  } finally {
    for (const app of apps) { (app.getHttpServer() as Server).closeAllConnections(); await app.close(); }
    await prisma.onModuleDestroy();
  }
});
