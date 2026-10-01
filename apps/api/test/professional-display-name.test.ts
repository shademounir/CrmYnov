import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { professionalDisplayName } from "../src/users/professional-display-name.js";
import { UserService } from "../src/users/user.service.js";
import { SessionService } from "../src/auth/session.service.js";
import { AuditService } from "../src/audit/audit.service.js";
import { viewDetailsSchema } from "../src/leads/view-sharing.openapi.js";
import { createCollaboratorBody } from "../src/users/user.openapi.js";

test("optional professional display name: NULL, trim, empty and synthetic Unicode", () => {
  for (const value of [undefined, null, "", "   "]) assert.equal(professionalDisplayName(value), null);
  assert.equal(professionalDisplayName("  Conseillère synthétique Équipe A  "), "Conseillère synthétique Équipe A");
  assert.equal(professionalDisplayName("É".repeat(120)), "É".repeat(120));
});

test("display name rejects oversized, non-string and control input with a value-free error", () => {
  for (const value of ["É".repeat(121), 123, {}, [], true, "Synthétique\n", "\tSynthétique", "Synthétique\u0000", "Synthétique\u0085"]) {
    assert.throws(() => professionalDisplayName(value), (error: unknown) => error instanceof ForbiddenException &&
      JSON.stringify(error.getResponse()) === '{"code":"professional_display_name_invalid"}');
  }
});

test("existing user creation validates names but never exposes them in general users or audit", () => {
  const audit = new AuditService(), users = new UserService(new SessionService(), audit);
  const name = "Responsable synthétique";
  const user = users.create({ professionalEmail: "unrelated-login@example.invalid", professionalDisplayName: ` ${name} `, roles: ["ADMIN"] }, "synthetic-admin", "synthetic-create");
  assert.equal("professionalDisplayName" in user, false);
  assert.equal(JSON.stringify(users.list()).includes(name), false);
  assert.equal(JSON.stringify(audit.list()).includes(name), false);
  assert.equal(JSON.stringify(audit.list()).includes("unrelated-login"), false);
  assert.equal(audit.list()[0]?.after?.displayNameProvided, true);
  users.create({ professionalEmail: "do-not-derive@example.invalid", roles: ["ADMIN"] }, "synthetic-admin", "synthetic-null");
  assert.equal(audit.list()[0]?.after?.displayNameProvided, false);
  const count = users.list().length, audits = audit.list().length;
  assert.throws(() => users.create({ professionalEmail: "invalid-name@example.invalid", professionalDisplayName: "bad\nname", roles: ["ADMIN"] }, "synthetic-admin", "synthetic-invalid"));
  assert.equal(users.list().length, count); assert.equal(audit.list().length, audits);
});

test("OpenAPI describes a write-only optional name and a minimal server-derived sharing contract", () => {
  const field = createCollaboratorBody.content["application/json"].schema.properties.professionalDisplayName;
  assert.equal(field.maxLength, 120); assert.equal(field.nullable, true); assert.equal(field.writeOnly, true);
  assert.equal(createCollaboratorBody.content["application/json"].schema.required.includes("professionalDisplayName"), false);
  assert.equal(viewDetailsSchema.additionalProperties, false);
  assert.deepEqual(viewDetailsSchema.properties.visibleAudiences.items.properties.type.enum, ["TEAM", "CAMPUS"]);
  for (const key of ["ownerDisplayName", "isOwner", "visibleAudiences", "canEdit", "canRevoke", "canDuplicate"]) assert.ok(viewDetailsSchema.required.includes(key));
  for (const key of ["professionalEmail", "ownerId", "roles", "grants", "token"]) assert.equal(key in viewDetailsSchema.properties, false);
});
