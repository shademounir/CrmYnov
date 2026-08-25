import assert from "node:assert/strict";
import test from "node:test";
import { RateLimitService } from "../src/auth/rate-limit.service.js";
import { canAccessScope, RbacGuard } from "../src/auth/rbac.guard.js";
import { SessionService } from "../src/auth/session.service.js";
import { isRole, type AuthenticatedRequest, type Principal } from "../src/auth/auth.types.js";
import { authenticationMiddleware } from "../src/auth/auth.middleware.js";
import { ResourceController } from "../src/auth/resource.controller.js";
import { SessionController } from "../src/auth/session.controller.js";
import { AuditService } from "../src/audit/audit.service.js";
import type { ExecutionContext } from "@nestjs/common";
import type { NextFunction, Response } from "express";
import { digestRecoveryValue, LocalCredentialAdapter } from "../src/access-recovery/access-recovery.store.js";
import { UserService } from "../src/users/user.service.js";

function hasErrorCode(code: string): (error: unknown) => boolean {
  return (error: unknown): boolean => error instanceof Error && "getResponse" in error && JSON.stringify((error as { getResponse: () => unknown }).getResponse()).includes(code);
}

test("sessions authenticate until explicit user revocation", () => {
  const sessions = new SessionService();
  const created = sessions.create("synthetic-user", ["ADMISSIONS"], [{ kind: "CAMPUS", id: "campus-a" }]);
  assert.equal(sessions.authenticate(created.token)?.userId, "synthetic-user");
  assert.equal(sessions.revokeUser("synthetic-user"), 1);
  assert.equal(sessions.authenticate(created.token), undefined);
  assert.equal(sessions.revokeUser("synthetic-user"), 0);
});

test("expired and forged session tokens fail closed", () => {
  const sessions = new SessionService();
  const expired = sessions.create("synthetic-user", ["AUDITOR"], [{ kind: "GLOBAL" }], -1);
  assert.equal(sessions.authenticate(expired.token), undefined);
  assert.equal(sessions.authenticate("forged-token"), undefined);
  assert.equal(sessions.revoke("missing-session"), false);
});

test("scope checks prevent cross-campus IDOR", () => {
  const principal: Principal = { userId: "synthetic-user", roles: ["ADMISSIONS"], scopes: [{ kind: "CAMPUS", id: "campus-a" }], sessionId: "session-a" };
  assert.equal(canAccessScope(principal, { kind: "CAMPUS", id: "campus-a" }), true);
  assert.equal(canAccessScope(principal, { kind: "CAMPUS", id: "campus-b" }), false);
  assert.equal(canAccessScope(principal, { kind: "TEAM", id: "team-a" }), false);
});

test("rate limiting is deterministic and isolated per key", () => {
  const limiter = new RateLimitService();
  for (let index = 0; index < 2; index += 1) limiter.assertAllowed("client-a", 1_000, 2, 1_000);
  assert.throws(
    () => limiter.assertAllowed("client-a", 1_000, 2, 1_000),
    hasErrorCode("rate_limit_exceeded"),
  );
  assert.doesNotThrow(() => limiter.assertAllowed("client-b", 1_000, 2, 1_000));
  assert.doesNotThrow(() => limiter.assertAllowed("client-a", 2_001, 2, 1_000));
});

test("role and authentication parsing reject malformed input", () => {
  assert.equal(isRole("AUDITOR"), true);
  assert.equal(isRole("FORGED"), false);
  const sessions = new SessionService();
  const session = sessions.create("synthetic-user", ["AUDITOR"], [{ kind: "GLOBAL" }]);
  const middleware = authenticationMiddleware(sessions);
  const next: NextFunction = () => undefined;
  const request = { header: (name: string) => name === "authorization" ? `Bearer ${session.token}` : undefined } as AuthenticatedRequest;
  middleware(request, {} as Response, next);
  assert.equal(request.principal?.sessionId, session.sessionId);
  const forged = { header: () => "Bearer forged" } as unknown as AuthenticatedRequest;
  middleware(forged, {} as Response, next);
  assert.equal(forged.principal, undefined);
});

test("session controller verifies a local credential, ownership and admin revocation", async () => {
  const sessions = new SessionService();
  const audit = new AuditService();
  const users = new UserService(sessions, audit);
  const credentials = new LocalCredentialAdapter();
  const userRecord = users.create({ professionalEmail: "synthetic-user@example.invalid", roles: ["AUDITOR"] }, "bootstrap", "auth-user");
  credentials.provisionTemporary(userRecord.id, "Temporary1!Value", digestRecoveryValue(userRecord.professionalEmail));
  const controller = new SessionController(sessions, new RateLimitService(), audit, credentials, users);
  const request = (value: Record<string, unknown>): AuthenticatedRequest => ({ header: () => "test-correlation", ...value }) as unknown as AuthenticatedRequest;
  await assert.rejects(controller.create({ ip: "client-a" } as AuthenticatedRequest, { email: "unknown@example.invalid", password: "invalid" }), hasErrorCode("identity_invalid"));
  const user = await controller.create(request({ ip: "client-a" }), { email: userRecord.professionalEmail, password: "Temporary1!Value" });
  await assert.rejects(
    controller.revoke({ principal: { userId: "other", roles: ["AUDITOR"], scopes: [{ kind: "GLOBAL" }], sessionId: "other-session" } } as AuthenticatedRequest, user.sessionId),
    hasErrorCode("session_ownership_required"),
  );
  assert.equal((await controller.revoke(request({ principal: { userId: userRecord.id, roles: ["AUDITOR"], scopes: [{ kind: "GLOBAL" }], sessionId: user.sessionId } }), user.sessionId)).revoked, true);
  await controller.create(request({ ip: "client-b" }), { email: userRecord.professionalEmail, password: "Temporary1!Value" });
  assert.equal((await controller.revokeUser(request({ principal: { userId: "synthetic-admin", roles: ["SUPER_ADMIN"], scopes: [{ kind: "GLOBAL" }], sessionId: "admin-session" } }), userRecord.id)).revokedSessions, 1);
});

test("resource controller fails closed for ownership and scope", () => {
  const controller = new ResourceController(new AuditService());
  const request = { header: () => "resource-correlation", principal: { userId: "synthetic-user", roles: ["ADMISSIONS"], scopes: [{ kind: "CAMPUS", id: "campus-a" }], sessionId: "session-a" } } as unknown as AuthenticatedRequest;
  assert.deepEqual(controller.update(request, "resource-a", { ownerId: "synthetic-user", scope: { kind: "CAMPUS", id: "campus-a" } }), { resourceId: "resource-a", updated: true });
  assert.throws(() => controller.update(request, "resource-a", { ownerId: "other", scope: { kind: "CAMPUS", id: "campus-a" } }), hasErrorCode("resource_not_found"));
  assert.throws(() => controller.update(request, "resource-a", { ownerId: "synthetic-user", scope: { kind: "CAMPUS", id: "campus-b" } }), hasErrorCode("resource_not_found"));
});

test("RBAC guard requires an authenticated principal and accepted role", () => {
  const reflector = { getAllAndOverride: (): string[] => ["SUPER_ADMIN"] };
  const guard = new RbacGuard(reflector as never);
  const contextFor = (request: AuthenticatedRequest): ExecutionContext => ({
    switchToHttp: () => ({ getRequest: (): AuthenticatedRequest => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  }) as unknown as ExecutionContext;
  assert.throws(() => guard.canActivate(contextFor({} as AuthenticatedRequest)), hasErrorCode("session_invalid"));
  const auditor = { principal: { userId: "auditor", roles: ["AUDITOR"], scopes: [{ kind: "GLOBAL" }], sessionId: "session-a" } } as AuthenticatedRequest;
  assert.throws(() => guard.canActivate(contextFor(auditor)), hasErrorCode("role_forbidden"));
  const admin = { principal: { userId: "admin", roles: ["SUPER_ADMIN"], scopes: [{ kind: "GLOBAL" }], sessionId: "session-b" } } as AuthenticatedRequest;
  assert.equal(guard.canActivate(contextFor(admin)), true);
});
