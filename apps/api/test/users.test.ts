import assert from "node:assert/strict";
import test from "node:test";
import { AuditService } from "../src/audit/audit.service.js";
import { SessionService } from "../src/auth/session.service.js";
import type { AuthenticatedRequest } from "../src/auth/auth.types.js";
import { UserController } from "../src/users/user.controller.js";
import { UserService } from "../src/users/user.service.js";

function hasResponseCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => {
    if (!(error instanceof Error) || !("getResponse" in error) || typeof error.getResponse !== "function") return false;
    return JSON.stringify(error.getResponse()).includes(code);
  };
}

const createService = (): { users: UserService; sessions: SessionService; audit: AuditService } => { const sessions = new SessionService(); const audit = new AuditService(); return { users: new UserService(sessions, audit), sessions, audit }; };

test("creates, filters and audits synthetic collaborators", () => {
  const { users, audit } = createService();
  const created = users.create({ professionalEmail: "Admin@Example.invalid", roles: ["SUPER_ADMIN"], campusId: "campus-a" }, "actor", "corr-1");
  assert.equal(created.professionalEmail, "admin@example.invalid");
  assert.equal(users.list({ campusId: "campus-a" }).length, 1);
  assert.equal(users.list({ campusId: "campus-b" }).length, 0);
  assert.equal(audit.list()[0]?.eventType, "COLLABORATOR_CREATED");
  assert.throws(() => users.create({ professionalEmail: "admin@example.invalid", roles: ["AUDITOR"] }, "actor", "corr-2"), hasResponseCode("professional_email_exists"));
});

test("protects the last active Super Admin and revokes sessions on deactivation", () => {
  const { users, sessions } = createService();
  const first = users.create({ professionalEmail: "first@example.invalid", roles: ["SUPER_ADMIN"] }, "actor", "corr-1");
  assert.throws(() => users.setActive(first.id, false, "actor", "corr-2"), hasResponseCode("last_super_admin_required"));
  users.create({ professionalEmail: "second@example.invalid", roles: ["SUPER_ADMIN"] }, "actor", "corr-3");
  const session = sessions.create(first.id, ["SUPER_ADMIN"], [{ kind: "GLOBAL" }]);
  assert.equal(users.setActive(first.id, false, "actor", "corr-4").active, false);
  assert.equal(sessions.authenticate(session.token), undefined);
});

test("fails closed on invalid identities and unknown users", () => {
  const { users } = createService();
  assert.throws(() => users.create({ professionalEmail: "invalid", roles: ["FORGED"] }, "actor", "corr"), hasResponseCode("collaborator_invalid"));
  assert.throws(() => users.setActive("missing", false, "actor", "corr"), hasResponseCode("collaborator_not_found"));
});

test("controller delegates protected creation, filtering and status changes", async () => {
  const { users } = createService();
  const controller = new UserController(users);
  const request = {
    principal: { userId: "synthetic-admin", roles: ["SUPER_ADMIN"], scopes: [{ kind: "GLOBAL" }], sessionId: "session-admin" },
    header: (name: string) => name === "x-correlation-id" ? "corr-controller" : undefined,
  } as AuthenticatedRequest;
  const first = await controller.create(request, { professionalEmail: "first@example.invalid", roles: ["SUPER_ADMIN"] });
  await controller.create(request, { professionalEmail: "second@example.invalid", roles: ["SUPER_ADMIN"] });
  assert.equal(controller.list("true", undefined, undefined).users.length, 2);
  assert.equal((await controller.setStatus(request, first.id, { active: false })).active, false);
  assert.equal(controller.list("false", undefined, undefined).users.length, 1);
});

test("updates multi-role authorization, scopes and immediately revokes sessions", () => {
  const { users, sessions, audit } = createService();
  users.create({ professionalEmail: "root@example.invalid", roles: ["SUPER_ADMIN"] }, "root", "corr-root");
  const collaborator = users.create({ professionalEmail: "agent@example.invalid", roles: ["ADMIN", "ADMISSIONS"], campusId: "campus-a" }, "root", "corr-create");
  const session = sessions.create(collaborator.id, ["ADMIN", "ADMISSIONS"], [{ kind: "CAMPUS", id: "campus-a" }]);
  const updated = users.updateAuthorization(collaborator.id, { roles: ["ADMISSIONS", "AUDITOR"], teamId: "team-b", reason: "TEAM_CHANGE", confirmed: true }, "root", "corr-update");
  assert.deepEqual(updated.roles, ["ADMISSIONS", "AUDITOR"]);
  assert.equal(updated.campusId, undefined);
  assert.equal(updated.teamId, "team-b");
  assert.equal(sessions.authenticate(session.token), undefined);
  const event = audit.list().find((candidate) => candidate.eventType === "COLLABORATOR_AUTHORIZATION_CHANGED");
  assert.deepEqual(event?.before, { roles: ["ADMIN", "ADMISSIONS"], campusId: "campus-a", teamId: undefined });
  assert.equal(event?.after?.reason, "TEAM_CHANGE");
});

test("authorization changes fail closed on missing confirmation, forged role and last admin", () => {
  const { users } = createService();
  const root = users.create({ professionalEmail: "root@example.invalid", roles: ["SUPER_ADMIN"] }, "root", "corr-root");
  assert.throws(() => users.updateAuthorization(root.id, { roles: ["ADMIN"], reason: "ACCESS_REVIEW", confirmed: true }, "root", "corr-last"), hasResponseCode("last_super_admin_required"));
  assert.throws(() => users.updateAuthorization(root.id, { roles: ["FORGED"], reason: "ACCESS_REVIEW", confirmed: true }, "root", "corr-role"), hasResponseCode("authorization_change_invalid"));
  assert.throws(() => users.updateAuthorization(root.id, { roles: ["SUPER_ADMIN"], reason: "free text", confirmed: false }, "root", "corr-confirm"), hasResponseCode("authorization_change_invalid"));
});
