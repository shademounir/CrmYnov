import type { Principal, Role } from "../auth/auth.types.js";
import { configurationKey, definition, GLOBAL_CAMPUS, permissionCatalogue, type ConfigurationSnapshot, type ConfigurationTarget, type Grants, type PermissionScope } from "./dynamic-contract.js";
import { auditDecision, auditRoles } from "./audit-access.js";

export interface EvaluationContext { campus: string; active: boolean; own: boolean; team: boolean; managedTeam?: boolean; campusAllowed: boolean; globalAllowed: boolean; restriction?: string }
export interface GrantExplanation { role: Role; sourceScope: PermissionScope; globalCeiling: PermissionScope; campusCeiling: PermissionScope; campusGrant: PermissionScope; allowed: boolean; restriction: string | null }
export interface PermissionDecision { permission: string; allowed: boolean; sources: GrantExplanation[]; restriction: string | null }
const readRoles: Role[] = ["SUPER_ADMIN", "ADMIN", "MANAGER", "ADMISSIONS", "AUDITOR"];
const managers: Role[] = ["SUPER_ADMIN", "ADMIN", "MANAGER"];
const defaultRoles: Record<string, readonly Role[]> = {
  "audit.view": auditRoles,
  "lead.create": ["SUPER_ADMIN", "ADMIN", "ADMISSIONS"], "lead.edit": [...managers, "ADMISSIONS"], "lead.assign": managers,
  "lead.reassign.request": [...managers, "ADMISSIONS"], "lead.reassign.approve": managers,
  "lead.close.request": [...managers, "ADMISSIONS"], "lead.close.approve": managers,
  "lead.tags.assign": [...managers, "ADMISSIONS"], "lead.collaborators.manage": [...managers, "ADMISSIONS"],
  "lead.tags.manage": ["SUPER_ADMIN", "ADMIN"], "lead.references.manage": ["SUPER_ADMIN", "ADMIN"], "lead.references.archive": ["SUPER_ADMIN", "ADMIN"],
  "interaction.create": [...managers, "ADMISSIONS"], "reminder.manage": [...managers, "ADMISSIONS"], "appointment.manage": [...managers, "ADMISSIONS"],
  "import.execute": ["SUPER_ADMIN", "ADMIN"], "import.confirm": ["SUPER_ADMIN", "ADMIN"], "import.review.resolve": managers,
  "roles.permissions.view": ["SUPER_ADMIN", "ADMIN"], "roles.permissions.manage": ["SUPER_ADMIN", "ADMIN"],
  "settings.campus.manage": ["SUPER_ADMIN", "ADMIN"], "settings.global.manage": ["SUPER_ADMIN"],
  "chat.use": [...managers, "ADMISSIONS"], "chat.broadcast": managers, "notification.manage": [...managers, "ADMISSIONS"],
};
export function defaultRoleScope(role: Role, permission: string): PermissionScope {
  const item = definition(permission);
  if (!item?.available || role === "AUDITOR" && item.mutation) return "NONE";
  if (role === "SUPER_ADMIN") return "GLOBAL";
  if (item.reserved || permission.startsWith("users.")) return "NONE";
  const allowed = defaultRoles[permission] ?? (item.mutation ? [] : readRoles);
  if (!allowed.includes(role)) return "NONE";
  if (role === "ADMISSIONS" && ["lead.edit", "lead.tags.assign", "lead.collaborators.manage"].includes(permission)) return "OWN";
  return "CAMPUS";
}
export function defaultConfiguration(target: ConfigurationTarget): Grants {
  return Object.fromEntries(permissionCatalogue.map((item) => {
    let scope: PermissionScope = item.available && target.kind === "CEILING" ? "GLOBAL" : defaultRoleScope(target.role as Role, item.key);
    if (target.campus !== GLOBAL_CAMPUS && scope === "GLOBAL") scope = item.reserved ? "NONE" : "CAMPUS";
    return [item.key, scope];
  }));
}
export function resolveGrants(rows: readonly ConfigurationSnapshot[], target: ConfigurationTarget): Grants {
  const matches = rows.filter((row) => configurationKey(row) === configurationKey(target));
  if (matches.length > 1) throw new Error("permission_configuration_ambiguous");
  return matches[0]?.grants ?? defaultConfiguration(target);
}
function includesResource(scope: PermissionScope, context: EvaluationContext, role: Role): boolean {
  switch (scope) {
    case "NONE": return false;
    case "GLOBAL": return context.globalAllowed || context.campusAllowed;
    case "CAMPUS": return context.campusAllowed;
    case "OWN": return context.campusAllowed && context.own;
    case "TEAM": return context.campusAllowed && (role === "MANAGER" ? context.managedTeam === true : context.team);
  }
}
function explainRole(role: Role, key: string, rows: readonly ConfigurationSnapshot[], context: EvaluationContext): GrantExplanation {
  const sourceScope = resolveGrants(rows, { kind: "ROLE", role, campus: GLOBAL_CAMPUS })[key] ?? "NONE";
  const globalCeiling = resolveGrants(rows, { kind: "CEILING", role: "*", campus: GLOBAL_CAMPUS })[key] ?? "NONE";
  const campusCeiling = context.campus === GLOBAL_CAMPUS ? "GLOBAL" : resolveGrants(rows, { kind: "CEILING", role: "*", campus: context.campus })[key] ?? "NONE";
  const campusTarget = { kind: "ROLE" as const, role, campus: context.campus };
  const campusRow = rows.find((row) => configurationKey(row) === configurationKey(campusTarget));
  const campusGrant = campusRow?.grants[key] ?? sourceScope;
  const scopeAllowed = [sourceScope, globalCeiling, campusCeiling, campusGrant].every((scope) => includesResource(scope, context, role));
  const invariant = role === "AUDITOR" && definition(key)?.mutation === true;
  const restriction = invariant ? "auditor_read_only" : context.restriction ?? (!context.active ? "resource_inactive" : null);
  return { role, sourceScope, globalCeiling, campusCeiling, campusGrant, allowed: scopeAllowed && !restriction, restriction };
}
export function evaluatePermission(principal: Principal, key: string, rows: readonly ConfigurationSnapshot[], context: EvaluationContext): PermissionDecision {
  if (!definition(key)?.available || !principal.userId || !principal.sessionId || principal.mustChangeSecret) return { permission: key, allowed: false, sources: [], restriction: "permission_or_session_invalid" };
  if (key === "audit.view") {
    // GLOBAL must come from actual grants and ceilings, never from a URL or role alone.
    const auditContext = { ...context, globalAllowed: true, campusAllowed: context.campus !== GLOBAL_CAMPUS && context.campusAllowed };
    const sources = [...new Set(principal.roles)].map((role) => explainRole(role, key, rows, auditContext));
    return auditDecision(sources, auditContext);
  }
  const sources = [...new Set(principal.roles)].map((role) => explainRole(role, key, rows, context));
  return { permission: key, allowed: sources.some((source) => source.allowed), sources, restriction: context.restriction ?? null };
}
