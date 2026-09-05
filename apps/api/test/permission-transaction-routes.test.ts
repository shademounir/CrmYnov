import assert from "node:assert/strict";
import test from "node:test";
import { lifecyclePermissionFence, permissionTransactionMode } from "../src/permissions/permission-transaction-routes.js";

test("CRMY-170 reviewed data readers share the PostgreSQL fence independently of HTTP names", () => {
  for (const [controller, handlers] of Object.entries({
    SavedLeadViewController: ["list"],
    ViewSharingController: ["audiences", "received", "history", "read"],
    DynamicPermissionController: ["catalogue", "read", "preview", "history", "effective", "teams"],
    LeadController: ["list", "detail"],
    ReferenceController: ["list", "readAvailability"],
    UserController: ["list"],
  })) for (const handler of handlers) assert.equal(permissionTransactionMode(controller, handler), "read", `${controller}.${handler}`);
});

test("CRMY-170 sharing, permission, identity and resource writers always exclude readers", () => {
  for (const [controller, handlers] of Object.entries({
    ViewSharingController: ["share", "revoke", "duplicate", "archive"],
    SavedLeadViewController: ["create", "update", "remove"],
    DynamicPermissionController: ["save", "restore", "saveTeam"],
    UserController: ["create", "setStatus", "updateAuthorization"],
    ReferenceController: ["create", "update", "availability", "legacy"],
    LeadController: ["create", "update"],
    LeadAssignmentController: ["assignOne", "assignBatch"],
    ReassignmentController: ["decide"],
    LeadCollaborationController: ["decide"],
  })) for (const handler of handlers) assert.equal(permissionTransactionMode(controller, handler), "write", `${controller}.${handler}`);
  assert.equal(permissionTransactionMode("UnknownController", "read"), "write");
  assert.equal(permissionTransactionMode("ViewSharingController", "unknownGetHandler"), "write");
  assert.equal(permissionTransactionMode("viewSharingController", "read"), "write");
});

test("CRMY-170 only the two existing audit reads may append consultation evidence under a shared fence", () => {
  assert.equal(permissionTransactionMode("AuditController", "list"), "read-audited");
  assert.equal(permissionTransactionMode("AuditController", "detail"), "read-audited");
  assert.equal(permissionTransactionMode("AuditController", "create"), "write");
  assert.equal(permissionTransactionMode("AuditController", "unknownRead"), "write");
  assert.equal(permissionTransactionMode("UnknownController", "auditRead"), "write");
});

test("CRMY-170 lifecycle revocations participate while first-login retains its distinct authentication contract", () => {
  assert.equal(lifecyclePermissionFence("SessionController", "revoke"), "session");
  assert.equal(lifecyclePermissionFence("SessionController", "revokeUser"), "session");
  assert.equal(lifecyclePermissionFence("SessionController", "create"), "session-create");
  assert.equal(lifecyclePermissionFence("FirstLoginController", "change"), "first-login");
  assert.equal(lifecyclePermissionFence("AccessRecoveryController", "complete"), "recovery");
  const outside: ReadonlyArray<readonly [string, string]> = [["AccessRecoveryController", "request"], ["HealthController", "read"], ["ForminatorWebhookController", "receive"], ["UnknownController", "revoke"]];
  for (const [controller, handler] of outside) {
    assert.equal(lifecyclePermissionFence(controller, handler), undefined);
  }
});
