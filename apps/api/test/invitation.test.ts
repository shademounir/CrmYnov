import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import type { Principal } from "../src/auth/auth.types.js";
import { InvitationService } from "../src/invitations/invitation.service.js";
import type { PrismaService } from "../src/persistence/prisma.service.js";
import type { GmailInvitationSender } from "../src/invitations/gmail-invitation.sender.js";
import type { DynamicPermissionRepository } from "../src/permissions/dynamic-repository.js";

const userId = randomUUID();
const actorId = randomUUID();
const sessionId = randomUUID();
const actor: Principal = { userId: actorId, sessionId, roles: ["SUPER_ADMIN"], scopes: [{ kind: "GLOBAL" }], mustChangeSecret: false };
type InvitationRow = { id: string; collaboratorId: string; linkDigest: string; state: string; expiresAt: Date; createdAt: Date; sentAt?: Date; usedAt?: Date };
type Fixture = { service: InvitationService; rows: InvitationRow[]; audits: Array<{ eventType: string; after: unknown }>; user: { firstLoginRequired: boolean; authenticationVersion: number }; sessions: Array<{ active: boolean }>; code: () => string; readonly passwordUpdates: number };

function fixture(failSend = false): Fixture {
  const user = { id: userId, professionalEmail: "synthetic@example.invalid", active: true, firstLoginRequired: true, authenticationVersion: 1, roles: ["ADMISSIONS"], campusId: "CAMPUS-TEST", teamId: null };
  const administrator = { id: actorId, professionalEmail: "admin@example.invalid", active: true, firstLoginRequired: false, authenticationVersion: 1, roles: ["SUPER_ADMIN"], campusId: null, teamId: null };
  const rows: InvitationRow[] = [];
  const audits: Array<{ eventType: string; after: unknown }> = [];
  const sessions = [{ collaboratorId: userId, active: true }];
  let link = "";
  let passwordUpdates = 0;
  const invitationStore = {
    count: ({ where }: { where: { collaboratorId: string; createdAt: { gt: Date } } }): Promise<number> => Promise.resolve(rows.filter((row) => row.collaboratorId === where.collaboratorId && row.createdAt > where.createdAt.gt).length),
    create: ({ data }: { data: { collaboratorId: string; linkDigest: string; state: string; expiresAt: Date } }): Promise<InvitationRow> => { const row = { id: randomUUID(), ...data, createdAt: new Date() }; rows.push(row); return Promise.resolve(row); },
    findUnique: ({ where }: { where: { linkDigest: string } }): Promise<InvitationRow | null> => Promise.resolve(rows.find((row) => row.linkDigest === where.linkDigest) ?? null),
    updateMany: ({ where, data }: { where: { id?: string; collaboratorId?: string; state?: string | { in: string[] }; expiresAt?: { gt: Date } }; data: { state: string; sentAt?: Date; usedAt?: Date } }): Promise<{ count: number }> => {
      const matches = rows.filter((row) => (!where.id || row.id === where.id) && (!where.collaboratorId || row.collaboratorId === where.collaboratorId) && (!where.state || (typeof where.state === "string" ? row.state === where.state : where.state.in.includes(row.state))) && (!where.expiresAt || row.expiresAt > where.expiresAt.gt));
      for (const row of matches) Object.assign(row, data);
      return Promise.resolve({ count: matches.length });
    },
  };
  const tx = {
    collaborator: { findUnique: ({ where }: { where: { id: string } }): Promise<typeof user | typeof administrator | null> => Promise.resolve(where.id === userId ? user : where.id === actorId ? administrator : null), update: ({ data }: { data: { firstLoginRequired: boolean; authenticationVersion: { increment: number } } }): Promise<void> => { user.firstLoginRequired = data.firstLoginRequired; user.authenticationVersion += data.authenticationVersion.increment; return Promise.resolve(); } },
    localSession: { findUnique: ({ where }: { where: { id: string } }): Promise<{ active: boolean; collaboratorId: string; expiresAt: Date; authenticationVersion: number } | null> => Promise.resolve(where.id === sessionId ? { active: true, collaboratorId: actorId, expiresAt: new Date(Date.now() + 60_000), authenticationVersion: 1 } : null), updateMany: (): Promise<{ count: number }> => { sessions[0]!.active = false; return Promise.resolve({ count: 1 }); } },
    localAccessInvitation: invitationStore,
    localPasswordHash: { upsert: (): Promise<void> => { passwordUpdates += 1; return Promise.resolve(); } },
    auditEvent: { create: ({ data }: { data: { eventType: string; after: unknown } }): Promise<void> => { audits.push(data); return Promise.resolve(); } },
  };
  const client = { ...tx, $transaction: (action: (value: typeof tx) => Promise<unknown>): Promise<unknown> => action(tx) };
  const prisma = { client } as unknown as PrismaService;
  const sender = { configured: (): boolean => true, publicOrigin: (): string => "https://dev.example.invalid", send: ({ link: value }: { link: string }): Promise<void> => { if (failSend) return Promise.reject(new Error("provider_private_error")); link = value; return Promise.resolve(); } } as GmailInvitationSender;
  const permissions = { transaction: (action: (value: typeof tx) => Promise<unknown>): Promise<unknown> => action(tx), snapshots: (): Promise<[]> => Promise.resolve([]) } as unknown as DynamicPermissionRepository;
  const service = new InvitationService(prisma, sender, permissions);
  const code = (): string => new URL(link).hash.slice("#code=".length);
  return { service, rows, audits, user, sessions, code, get passwordUpdates(): number { return passwordUpdates; } };
}

test("invitation GET does not consume; completion is unique, persisted and revokes old sessions", async () => {
  const state = fixture();
  assert.deepEqual(await state.service.issue(userId, actor), { state: "ACCEPTED_BY_GMAIL" });
  assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0]?.state, "SENT");
  assert.equal(state.audits.filter((event) => event.eventType === "ACCESS_INVITATION_REQUESTED").length, 1);
  assert.equal(state.rows[0]?.linkDigest.includes(state.code()), false);
  assert.equal(state.rows[0]?.state, "SENT", "opening the link performs no mutation");
  const secret = "Synthetic-Password-2026!";
  const results = await Promise.allSettled([state.service.complete(state.code(), secret), state.service.complete(state.code(), secret)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(state.passwordUpdates, 1);
  assert.equal(state.user.firstLoginRequired, false);
  assert.equal(state.user.authenticationVersion, 2);
  assert.equal(state.sessions[0]?.active, false);
  assert.equal(state.audits.filter((event) => event.eventType === "ACCESS_INVITATION_COMPLETED").length, 1);
  await assert.rejects(state.service.complete(state.code(), secret), ConflictException);
});

test("reissue revokes the older invitation and the new one can be used", async () => {
  const state = fixture();
  await state.service.issue(userId, actor);
  const old = state.code();
  await state.service.issue(userId, actor);
  assert.equal(state.rows[0]?.state, "REVOKED");
  await assert.rejects(state.service.complete(old, "Synthetic-Password-2026!"), ConflictException);
  assert.deepEqual(await state.service.complete(state.code(), "Synthetic-Password-2026!"), { completed: true });
});

test("expired and failed-delivery invitations never activate a user", async () => {
  const expired = fixture();
  await expired.service.issue(userId, actor);
  expired.rows[0]!.expiresAt = new Date(0);
  await assert.rejects(expired.service.complete(expired.code(), "Synthetic-Password-2026!"), ConflictException);
  assert.equal(expired.passwordUpdates, 0);
  const failed = fixture(true);
  await assert.rejects(failed.service.issue(userId, actor), ServiceUnavailableException);
  assert.equal(failed.rows[0]?.state, "SEND_UNCONFIRMED");
  assert.equal(failed.passwordUpdates, 0);
});
