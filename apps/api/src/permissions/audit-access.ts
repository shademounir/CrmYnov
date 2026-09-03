import type { Principal, Role } from "../auth/auth.types.js";
import type { EvaluationContext, GrantExplanation, PermissionDecision } from "./dynamic-evaluator.js";

export const auditRoles: readonly Role[] = ["SUPER_ADMIN", "ADMIN", "AUDITOR"];
export function hasAuditRole(principal: Principal): boolean {
  return principal.roles.some((role) => auditRoles.includes(role));
}

/** CRMY-54: only eligible role sources contribute; applicable grants intersect. */
export function auditDecision(sources: GrantExplanation[], context: EvaluationContext): PermissionDecision {
  const eligible = sources.filter((source) => auditRoles.includes(source.role) && source.sourceScope !== "NONE");
  const allowed = eligible.length > 0 && eligible.every((source) => source.allowed);
  return { permission: "audit.view", allowed, sources, restriction: allowed ? null : context.restriction ?? "audit_scope_or_role_denied" };
}
