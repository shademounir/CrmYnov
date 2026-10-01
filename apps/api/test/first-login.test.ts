import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionContext } from "@nestjs/common";
import { LocalCredentialAdapter } from "../src/access-recovery/access-recovery.store.js";
import { AuditService } from "../src/audit/audit.service.js";
import type { AuthenticatedRequest } from "../src/auth/auth.types.js";
import { RbacGuard } from "../src/auth/rbac.guard.js";
import { SessionService } from "../src/auth/session.service.js";
import { FirstLoginController } from "../src/first-login/first-login.controller.js";
import { FirstLoginService } from "../src/first-login/first-login.service.js";

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof Error && "getResponse" in error && JSON.stringify((error as { getResponse: () => unknown }).getResponse()).includes(code);
}

test("replaces a temporary synthetic secret, revokes sessions and audits without secret", () => {
  const credentials = new LocalCredentialAdapter();
  const sessions = new SessionService();
  const audit = new AuditService();
  credentials.provisionTemporary("synthetic-user", "Temporary1!Value");
  const active = sessions.create("synthetic-user", ["ADMIN"], [{ kind: "GLOBAL" }], 3_600_000, true);
  const service = new FirstLoginService(credentials, sessions, audit);
  assert.deepEqual(service.change("synthetic-user", "Temporary1!Value", "Replacement2!Value", "corr-first"), { revokedSessions: 1 });
  assert.equal(sessions.authenticate(active.token), undefined);
  assert.equal(credentials.requiresChange("synthetic-user"), false);
  assert.equal(credentials.hasStoredRawSecret("Temporary1!Value"), false);
  assert.equal(credentials.hasStoredRawSecret("Replacement2!Value"), false);
  assert.equal(audit.list()[0]?.eventType, "FIRST_LOGIN_SECRET_CHANGED");
  assert.doesNotMatch(JSON.stringify(audit.list()), /Temporary1|Replacement2/);
});

test("refuses invalid, reused or already consumed temporary credentials", () => {
  const credentials = new LocalCredentialAdapter();
  const service = new FirstLoginService(credentials, new SessionService(), new AuditService());
  credentials.provisionTemporary("synthetic-user", "Temporary1!Value");
  assert.throws(() => service.change("synthetic-user", "wrong", "Replacement2!Value", "corr-a"), hasCode("temporary_credential_invalid"));
  assert.throws(() => service.change("synthetic-user", "Temporary1!Value", "short", "corr-b"), hasCode("secret_policy_refused"));
  assert.throws(() => service.change("synthetic-user", "Temporary1!Value", "Temporary1!Value", "corr-c"), hasCode("secret_policy_refused"));
  service.change("synthetic-user", "Temporary1!Value", "Replacement2!Value", "corr-d");
  assert.throws(() => service.change("synthetic-user", "Replacement2!Value", "Another3!Replacement", "corr-e"), hasCode("temporary_credential_invalid"));
});

test("controller requires authentication and RBAC blocks pending sessions", async () => {
  const credentials = new LocalCredentialAdapter();
  const sessions = new SessionService();
  credentials.provisionTemporary("synthetic-user", "Temporary1!Value");
  const service = new FirstLoginService(credentials, sessions, new AuditService());
  const controller = new FirstLoginController(service);
  const request = { principal: { userId: "synthetic-user", roles: ["ADMIN"], scopes: [{ kind: "GLOBAL" }], sessionId: "session", mustChangeSecret: true }, header: (): string => "corr-controller" } as unknown as AuthenticatedRequest;
  assert.deepEqual(await controller.change(request, { currentSecret: "Temporary1!Value", nextSecret: "Replacement2!Value" }), { revokedSessions: 0 });
  await assert.rejects(controller.change({} as AuthenticatedRequest, {}), hasCode("session_invalid"));

  const reflector = { getAllAndOverride: (): never[] => [] };
  const guard = new RbacGuard(reflector as never);
  const context = {
    switchToHttp: (): { getRequest: () => AuthenticatedRequest } => ({ getRequest: (): AuthenticatedRequest => request }),
    getHandler: (): undefined => undefined,
    getClass: (): undefined => undefined,
  } as unknown as ExecutionContext;
  assert.throws(() => guard.canActivate(context), hasCode("secret_change_required"));
});
