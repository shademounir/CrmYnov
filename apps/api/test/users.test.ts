import assert from "node:assert/strict";
import test from "node:test";
import { AuditService } from "../src/audit/audit.service.js";
import { SessionService } from "../src/auth/session.service.js";
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
