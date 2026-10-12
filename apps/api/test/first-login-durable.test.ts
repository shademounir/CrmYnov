import assert from "node:assert/strict";
import test from "node:test";
import { deriveSecret, LocalCredentialAdapter } from "../src/access-recovery/access-recovery.store.js";
import { AuditService } from "../src/audit/audit.service.js";
import { SessionService } from "../src/auth/session.service.js";
import { FirstLoginService } from "../src/first-login/first-login.service.js";
import type { PrismaService } from "../src/persistence/prisma.service.js";

const temporary = "Synthetic-Temporary!9", replacement = "Synthetic-Replacement!9";
type SyntheticUser = { id: string; active: boolean; firstLoginRequired: boolean; authenticationVersion: number; roles: string[]; campusId: null; passwordHash: { mustChange: boolean; passwordSalt: string; passwordDigest: string } };
type SyntheticSession = { active: boolean; collaboratorId: string; expiresAt: Date; authenticationVersion: number };
type SyntheticTransaction = {
  $queryRaw: () => Promise<unknown[]>;
  collaborator: { findUnique: () => Promise<SyntheticUser | null>; update: () => Promise<object> };
  localPasswordHash: { update: () => Promise<object> };
  localSession: { findUnique: () => Promise<SyntheticSession | null>; updateMany: () => Promise<{ count: number }>; create: () => Promise<object> };
  localAccessInvitation: { updateMany: () => Promise<{ count: number }> };
  auditEvent: { create: (event: unknown) => Promise<object> };
};
type SyntheticHarness = { user: SyntheticUser; session: SyntheticSession; tx: SyntheticTransaction; calls: string[]; audits: unknown[]; sessions: SessionService; service: FirstLoginService };
function harness(): SyntheticHarness {
  const calls: string[] = [];
  const user = { id: "synthetic", active: true, firstLoginRequired: true, authenticationVersion: 1, roles: ["SUPER_ADMIN"], campusId: null, passwordHash: { mustChange: true, passwordSalt: "synthetic-salt", passwordDigest: deriveSecret(temporary, "synthetic-salt") } };
  const session = { active: true, collaboratorId: user.id, expiresAt: new Date(Date.now() + 60000), authenticationVersion: 1 };
  const audits: unknown[] = [];
  const tx = {
    $queryRaw: (): Promise<unknown[]> => { calls.push("lock"); return Promise.resolve([]); },
    collaborator: { findUnique: (): Promise<typeof user | null> => Promise.resolve(user), update: (): Promise<object> => { calls.push("identity"); return Promise.resolve({}); } },
    localPasswordHash: { update: (): Promise<object> => { calls.push("credential"); return Promise.resolve({}); } },
    localSession: { findUnique: (): Promise<typeof session | null> => Promise.resolve(session), updateMany: (): Promise<{ count: number }> => { calls.push("revoke"); return Promise.resolve({ count: 2 }); }, create: (): Promise<object> => { calls.push("session"); return Promise.resolve({}); } },
    localAccessInvitation: { updateMany: (): Promise<{ count: number }> => { calls.push("invitations"); return Promise.resolve({ count: 0 }); } },
    auditEvent: { create: (event: unknown): Promise<object> => { calls.push("audit"); audits.push(event); return Promise.resolve({}); } },
  };
  const prisma = { client: { $transaction: async <T>(action: (transaction: typeof tx) => Promise<T>, options: { isolationLevel: string }): Promise<T> => { assert.equal(options.isolationLevel, "Serializable"); return action(tx); } } } as unknown as PrismaService;
  const sessions = new SessionService(prisma);
  return { user, session, tx, calls, audits, sessions, service: new FirstLoginService(new LocalCredentialAdapter(), sessions, new AuditService(), undefined, prisma) };
}
test("durable first login orders the security writes and audits only non-secret metadata", async () => {
  const h = harness();
  assert.deepEqual(await h.service.changeForApi("synthetic", temporary, replacement, "correlation", "session"), { revokedSessions: 2 });
  assert.deepEqual(h.calls, ["lock", "credential", "identity", "revoke", "invitations", "audit"]);
  assert.equal(h.audits.length, 1); assert.ok(!JSON.stringify(h.audits).includes(temporary)); assert.ok(!JSON.stringify(h.audits).includes(replacement));
});
test("durable first login refuses invalid policy and stale/inactive/expired identities before writes", async () => {
  for (const invalid of ["short", temporary, "x".repeat(129), "Synthetic Space!9"]) { const h = harness(); await assert.rejects(h.service.changeForApi("synthetic", temporary, invalid, "c", "s")); assert.deepEqual(h.calls, []); }
  for (const mutate of [
    (h: ReturnType<typeof harness>): void => { h.user.active = false; },
    (h: ReturnType<typeof harness>): void => { h.user.firstLoginRequired = false; },
    (h: ReturnType<typeof harness>): void => { h.user.passwordHash.mustChange = false; },
    (h: ReturnType<typeof harness>): void => { h.session.active = false; },
    (h: ReturnType<typeof harness>): void => { h.session.collaboratorId = "other"; },
    (h: ReturnType<typeof harness>): void => { h.session.authenticationVersion = 0; },
    (h: ReturnType<typeof harness>): void => { h.session.expiresAt = new Date(0); },
    (h: ReturnType<typeof harness>): void => { h.tx.collaborator.findUnique = (): Promise<null> => Promise.resolve(null); },
    (h: ReturnType<typeof harness>): void => { h.tx.localSession.findUnique = (): Promise<null> => Promise.resolve(null); },
  ]) { const h = harness(); mutate(h); await assert.rejects(h.service.changeForApi("synthetic", temporary, replacement, "c", "s")); assert.deepEqual(h.calls, ["lock"]); }
  const wrong = harness(); await assert.rejects(wrong.service.changeForApi("synthetic", "incorrect", replacement, "c", "s")); assert.deepEqual(wrong.calls, ["lock"]);
  const oversized = harness(); await assert.rejects(oversized.service.changeForApi("synthetic", "x".repeat(129), replacement, "c", "s")); assert.deepEqual(oversized.calls, []);
});
test("audit persistence failure propagates rather than returning activation success", async () => {
  const h = harness(); h.tx.auditEvent.create = (): Promise<never> => Promise.reject(new Error("synthetic-audit-failure"));
  await assert.rejects(h.service.changeForApi("synthetic", temporary, replacement, "c", "s"), /synthetic-audit-failure/u);
});
test("durable session creation couples session/audit and rejects changed identity", async () => {
  const h = harness();
  const created = await h.sessions.createForApi("synthetic", ["SUPER_ADMIN"], [{ kind: "GLOBAL" }], true, 1, "c", "192.0.2.4");
  assert.ok(created.token); assert.ok(created.sessionId); assert.deepEqual(h.calls, ["lock", "session", "audit"]);
  assert.ok(!JSON.stringify(h.audits).includes(created.token)); assert.match(JSON.stringify(h.audits), /192\.0\.2\.0/u);
  for (const mutate of [(x: ReturnType<typeof harness>): void => { x.user.active = false; }, (x: ReturnType<typeof harness>): void => { x.user.authenticationVersion = 2; }, (x: ReturnType<typeof harness>): void => { x.user.roles = ["AUDITOR"]; }, (x: ReturnType<typeof harness>): void => { x.user.firstLoginRequired = false; x.user.passwordHash.mustChange = false; }]) {
    const stale = harness(); mutate(stale); await assert.rejects(stale.sessions.createForApi("synthetic", ["SUPER_ADMIN"], [{ kind: "GLOBAL" }], true, 1, "c")); assert.deepEqual(stale.calls, ["lock"]);
  }
  await assert.rejects(new SessionService().createForApi("synthetic", [], [], false, 1, "c"), /persistent_session_store_required/u);
});
