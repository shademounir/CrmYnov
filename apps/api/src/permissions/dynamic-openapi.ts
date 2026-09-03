import { permissionCatalogue } from "./dynamic-contract.js";
const scope = { type: "string", enum: ["NONE", "OWN", "TEAM", "CAMPUS", "GLOBAL"] };
const grants = { type: "object", additionalProperties: false, required: permissionCatalogue.map((item) => item.key), properties: Object.fromEntries(permissionCatalogue.map((item) => [item.key, { ...scope, enum: item.scopes }])) };
const target = { kind: { type: "string", enum: ["ROLE", "CEILING"] }, role: { type: "string", enum: ["*", "SUPER_ADMIN", "ADMIN", "MANAGER", "ADMISSIONS", "AUDITOR"] }, campus: { type: "string", description: "GLOBAL or a server-known active campus UUID. Campus cannot exceed the global ceiling." } };
const input = { type: "object", additionalProperties: false, required: [...Object.keys(target), "grants", "expectedVersion", "reason", "confirmed"], properties: { ...target, grants, expectedVersion: { type: "integer", minimum: 0 }, reason: { type: "string", enum: ["ACCESS_REVIEW", "RESPONSIBILITY_CHANGE", "CAMPUS_RESTRICTION", "RESTORE_VERSION"] }, confirmed: { type: "boolean" } } };
const responses = { "200": { description: "Authorized read; no grant changed" }, "201": { description: "Validated result; preview never changes grants" }, "400": { description: "Closed catalogue, scope or payload rejected" }, "401": { description: "Session required" }, "403": { description: "Role, campus, ceiling, delegation or invariant rejected" }, "409": { description: "Optimistic conflict, no change or last Super Admin protection" }, "503": { description: "Authorization store unavailable; no fallback" } };
const parameters = Object.entries(target).map(([name, schema]) => ({ name, in: "query", required: true, schema }));
const security = [{ bearerAuth: [] }];
export const dynamicPermissionPaths = {
  "/admin/role-permissions/team-responsibilities": {
    get: { summary: "Super Admin reads explicit team management responsibilities; membership alone is not proof", security, responses },
    post: { summary: "Super Admin explicitly assigns or revokes a current campus team responsibility, with audit and optimistic version", security, requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["teamId", "campusId", "managerId", "active", "expectedVersion", "confirmed"], properties: { teamId: { type: "string", maxLength: 64 }, campusId: { type: "string", format: "uuid" }, managerId: { type: "string", format: "uuid" }, active: { type: "boolean" }, expectedVersion: { type: "integer", minimum: 0 }, confirmed: { type: "boolean", enum: [true] } } } } } }, responses },
  },
  "/admin/role-permissions/catalogue": { get: { summary: "Read the versioned closed catalogue and five immutable system roles", security, parameters: [{ name: "campus", in: "query", required: false, schema: target.campus }], responses } },
  "/admin/role-permissions/configuration": {
    get: { summary: "Read explicit or inherited grants, version and global ceiling", security, parameters, responses },
    post: { summary: "Atomically append a version and audit; AUDITOR mutations and lead.delete cannot be granted", security, requestBody: { required: true, content: { "application/json": { schema: input } } }, responses },
  },
  "/admin/role-permissions/preview": { post: { summary: "Preview additions, removals, widening, reduction and affected count without persisting grants", security, requestBody: { required: true, content: { "application/json": { schema: input } } }, responses } },
  "/admin/role-permissions/history": { get: { summary: "Read the latest 50 immutable versions and minimized authorship audit", security, parameters, responses } },
  "/admin/role-permissions/restore": { post: { summary: "Restore old grants as a new version under current ceilings and invariants", security, requestBody: { required: true, content: { "application/json": { schema: { ...input, required: input.required.filter((key) => key !== "grants").concat("restoreVersion"), properties: { ...Object.fromEntries(Object.entries(input.properties).filter(([key]) => key !== "grants")), restoreVersion: { type: "integer", minimum: 1 } } } } } }, responses } },
  "/admin/role-permissions/effective": { get: { summary: "Explain the caller's role union intersected with ceilings and server-loaded resource context; action-specific business rules still apply", security, parameters: [{ name: "campus", in: "query", required: true, schema: target.campus }, { name: "leadId", in: "query", required: false, schema: { type: "string", format: "uuid" } }], responses } },
};
