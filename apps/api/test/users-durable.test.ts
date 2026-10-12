import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException } from "@nestjs/common";
import { UserService } from "../src/users/user.service.js";
import { SessionService } from "../src/auth/session.service.js";
import { AuditService } from "../src/audit/audit.service.js";
import type { PrismaService } from "../src/persistence/prisma.service.js";

function fixture(): { service: UserService; calls: string[] } {
  const calls: string[] = [];
  const user = { id: "synthetic", professionalEmail: "synthetic@example.invalid", roles: ["SUPER_ADMIN"], active: true, firstLoginRequired: false, authenticationVersion: 1, campusId: null, teamId: null };
  const tx = {
    $queryRaw: (): Promise<unknown[]> => { calls.push("lock"); return Promise.resolve([]); },
    collaborator: { findUnique: (): Promise<typeof user> => Promise.resolve(user), count: (): Promise<number> => Promise.resolve(1), update: (): Promise<never> => { calls.push("unexpected-write"); return Promise.reject(new Error("unexpected-write")); } },
  };
  const prisma = { client: { $transaction: <T>(action: (transaction: typeof tx) => Promise<T>): Promise<T> => action(tx) } } as unknown as PrismaService;
  return { service: new UserService(new SessionService(), new AuditService(), prisma), calls };
}

test("persistent governed role change protects the last active Super Admin before any write", async () => {
  const f = fixture();
  await assert.rejects(f.service.updateAuthorizationForApi("synthetic", { roles: ["ADMISSIONS"], reason: "ACCESS_REVIEW", confirmed: true }, "synthetic", "c"), (error: unknown) => error instanceof ConflictException && (error.getResponse() as { code?: string }).code === "last_super_admin_required");
  assert.deepEqual(f.calls, ["lock"]);
});

test("persistent governed role change rejects forged roles, scope and missing confirmation before transaction", async () => {
  for (const input of [
    { roles: ["FORGED"], reason: "ACCESS_REVIEW", confirmed: true },
    { roles: [], reason: "ACCESS_REVIEW", confirmed: true },
    { roles: ["SUPER_ADMIN"], reason: "FORGED", confirmed: true },
    { roles: ["SUPER_ADMIN"], reason: "ACCESS_REVIEW", confirmed: false },
    { roles: ["SUPER_ADMIN"], reason: "ACCESS_REVIEW", confirmed: true, campusId: "../invalid" },
  ]) { const f = fixture(); await assert.rejects(f.service.updateAuthorizationForApi("synthetic", input, "synthetic", "c")); assert.deepEqual(f.calls, []); }
});

test("persistent identity creation rejects invalid identity and scope before transaction", async () => {
  for (const input of [
    { professionalEmail: "invalid", roles: ["ADMISSIONS"] },
    { professionalEmail: "valid@example.invalid", secondaryEmail: "invalid", roles: ["ADMISSIONS"] },
    { professionalEmail: "valid@example.invalid", roles: ["FORGED"] },
    { professionalEmail: "valid@example.invalid", roles: [] },
    { professionalEmail: "valid@example.invalid", roles: ["ADMISSIONS"], teamId: "../invalid" },
  ]) { const f = fixture(); await assert.rejects(f.service.createForApi(input, "synthetic", "c")); assert.deepEqual(f.calls, []); }
});
