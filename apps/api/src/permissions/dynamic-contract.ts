import { BadRequestException } from "@nestjs/common";
import { isRole, type Role } from "../auth/auth.types.js";

export const scopes = ["NONE", "OWN", "TEAM", "CAMPUS", "GLOBAL"] as const;
export type PermissionScope = typeof scopes[number];
export type ConfigurationKind = "CEILING" | "ROLE";
export interface PermissionDefinition { key: string; module: string; mutation: boolean; sensitive: boolean; scopes: readonly PermissionScope[]; reserved: boolean; available: boolean }
const keys = [
  "lead.view", "lead.create", "lead.edit", "lead.assign", "lead.reassign.request", "lead.reassign.approve", "lead.close.request", "lead.close.approve", "lead.tags.assign", "lead.collaborators.manage",
  "lead.tags.manage", "lead.references.view", "lead.references.manage", "lead.references.archive", "interaction.create", "interaction.view", "reminder.manage", "appointment.manage",
  "import.view", "import.execute", "import.confirm", "import.review.resolve", "import.report.export", "reporting.view", "reporting.export", "reporting.global.view",
  "users.view", "users.create", "users.edit", "users.disable", "users.roles.assign", "roles.permissions.view", "roles.permissions.manage", "settings.campus.manage", "settings.global.manage",
  "audit.view", "audit.export", "chat.use", "chat.broadcast", "notification.manage",
] as const;
const readOnly = new Set<string>(keys.filter((key) => key.endsWith(".view") || key.endsWith(".export")));
const globalOnly = new Set(["settings.global.manage", "reporting.global.view"]);
// No existing edit-profile or audit-export action; do not advertise a working grant.
const unavailable = new Set(["users.edit", "audit.export"]);
export const permissionCatalogue: readonly PermissionDefinition[] = keys.map((key) => ({
  key, module: key.split(".")[0]!, mutation: !readOnly.has(key), available: !unavailable.has(key),
  sensitive: !readOnly.has(key) || key.startsWith("audit."), reserved: globalOnly.has(key),
  scopes: unavailable.has(key) ? ["NONE"] : globalOnly.has(key) ? ["NONE", "GLOBAL"] : key.startsWith("lead.") || key.startsWith("interaction.") ? scopes : ["NONE", "CAMPUS", "GLOBAL"],
}));
export type Grants = Record<string, PermissionScope>;
export interface ConfigurationTarget { kind: ConfigurationKind; role: Role | "*"; campus: string }
export interface ConfigurationInput extends ConfigurationTarget { expectedVersion: number; grants: Grants; reason: string; confirmed: boolean }
export interface ConfigurationSnapshot extends ConfigurationTarget { id: string; version: number; grants: Grants }
export const GLOBAL_CAMPUS = "GLOBAL";
export function configurationKey(target: ConfigurationTarget): string { return `${target.kind}:${target.role}:${target.campus}`; }
export function definition(key: string): PermissionDefinition | undefined { return permissionCatalogue.find((item) => item.key === key); }
export function invalidConfiguration(): never { throw new BadRequestException({ code: "role_permission_configuration_invalid" }); }
export function validateTarget(value: ConfigurationTarget): void {
  if (!["CEILING", "ROLE"].includes(value.kind) || typeof value.campus !== "string" || !/^[a-zA-Z0-9_-]{2,80}$/.test(value.campus)) invalidConfiguration();
  if (value.kind === "CEILING" ? value.role !== "*" : !isRole(value.role)) invalidConfiguration();
}
export function validateGrants(grants: unknown, target: ConfigurationTarget): asserts grants is Grants {
  if (!grants || typeof grants !== "object" || Array.isArray(grants)) invalidConfiguration();
  const entries = Object.entries(grants as Record<string, unknown>);
  if (entries.length !== permissionCatalogue.length) invalidConfiguration();
  for (const [key, scope] of entries) {
    const item = definition(key);
    if (!item || !item.scopes.some((allowed) => allowed === scope) || target.role === "AUDITOR" && item.mutation && scope !== "NONE") invalidConfiguration();
    if (target.campus !== GLOBAL_CAMPUS && scope === "GLOBAL") invalidConfiguration();
    if (item.reserved && target.campus !== GLOBAL_CAMPUS && scope !== "NONE") invalidConfiguration();
  }
}
export function validateInput(input: ConfigurationInput): void {
  if (!input || typeof input !== "object") invalidConfiguration();
  const allowed = ["kind", "role", "campus", "expectedVersion", "grants", "reason", "confirmed"];
  if (Object.keys(input).some((key) => !allowed.includes(key))) invalidConfiguration();
  validateTarget(input); validateGrants(input.grants, input);
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || typeof input.confirmed !== "boolean") invalidConfiguration();
  if (!["ACCESS_REVIEW", "RESPONSIBILITY_CHANGE", "RESTORE_VERSION", "CAMPUS_RESTRICTION"].includes(input.reason)) invalidConfiguration();
}
/** OWN and TEAM are not ordered: their intersection is checked against each resource. */
export function scopeWithin(candidate: PermissionScope, ceiling: PermissionScope): boolean {
  return candidate === "NONE" || candidate === ceiling || ceiling === "GLOBAL" || ceiling === "CAMPUS" && ["OWN", "TEAM"].includes(candidate);
}
