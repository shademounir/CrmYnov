import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { Principal, Role } from "../auth/auth.types.js";
import { definition } from "./dynamic-contract.js";
import { hasAuditRole } from "./audit-access.js";

export const permissionKeys = ["lead.tags.assign", "lead.tags.manage", "lead.references.view", "lead.references.manage", "lead.references.archive", "settings.campus.manage", "settings.global.manage"] as const;
export type PermissionKey = typeof permissionKeys[number];
export const businessRoleLabels: Readonly<Record<Role, string>> = { SUPER_ADMIN: "Super Admin", ADMIN: "Admin", MANAGER: "Manager commercial", ADMISSIONS: "Conseiller", AUDITOR: "Lecteur" };

/** Constructed from server-loaded reference/lead records, never from a request body. */
export interface ResourceContext {
  scope: "GLOBAL" | "CAMPUS";
  campusKeys: readonly string[];
  active: boolean;
  ownerId?: string;
  collaboratorIds?: readonly string[];
  readableResource?: boolean;
}
type GrantScope = "GLOBAL" | "CAMPUS" | "APPLICABLE" | "ACTIVE_APPLICABLE" | "OWNER" | "READABLE_RESOURCE";
export interface Grant { permission: PermissionKey; scope: GrantScope }
export abstract class GrantProvider {
  abstract grants(principal: Principal): Promise<readonly Grant[]>;
  decision?(principal: Principal, permission: string, resource: ResourceContext): Promise<boolean>;
}

const defaultGrants: Readonly<Record<Role, readonly Grant[]>> = {
  SUPER_ADMIN: permissionKeys.map((permission) => ({ permission, scope: "GLOBAL" })),
  ADMIN: [
    { permission: "lead.tags.assign", scope: "CAMPUS" }, { permission: "lead.tags.manage", scope: "CAMPUS" },
    { permission: "lead.references.view", scope: "APPLICABLE" }, { permission: "lead.references.manage", scope: "CAMPUS" },
    { permission: "lead.references.archive", scope: "CAMPUS" }, { permission: "settings.campus.manage", scope: "CAMPUS" },
  ],
  MANAGER: [{ permission: "lead.tags.assign", scope: "CAMPUS" }, { permission: "lead.references.view", scope: "ACTIVE_APPLICABLE" }],
  ADMISSIONS: [{ permission: "lead.tags.assign", scope: "OWNER" }, { permission: "lead.references.view", scope: "ACTIVE_APPLICABLE" }],
  AUDITOR: [{ permission: "lead.references.view", scope: "READABLE_RESOURCE" }],
};

@Injectable()
export class DefaultGrantProvider extends GrantProvider {
  grants(principal: Principal): Promise<readonly Grant[]> {
    return Promise.resolve(principal.roles.flatMap((role) => defaultGrants[role] ?? []));
  }
}

@Injectable()
export class PermissionService {
  constructor(@Inject(GrantProvider) private readonly provider: GrantProvider) {}

  async can(principal: Principal | undefined, permission: string, context: ResourceContext): Promise<boolean> {
    if (!principal?.userId || !principal.sessionId || principal.mustChangeSecret) return false;
    if (permission === "audit.view" && !hasAuditRole(principal)) return false;
    try {
      if (this.provider.decision) return definition(permission)?.available === true && await this.provider.decision(principal, permission, context);
      if (!(permissionKeys as readonly string[]).includes(permission)) return false;
      const grants = await this.provider.grants(principal);
      return grants.some((grant) => grant.permission === permission && this.matches(grant.scope, principal, context));
    } catch { return false; }
  }

  async assertCan(principal: Principal | undefined, permission: string, context: ResourceContext): Promise<void> {
    if (!await this.can(principal, permission, context)) throw new ForbiddenException({ code: "permission_denied" });
  }

  private matches(scope: GrantScope, principal: Principal, context: ResourceContext): boolean {
    // A legacy GLOBAL session scope never upgrades an Admin's CAMPUS grant.
    const ownCampus = principal.scopes.some((item) => item.kind === "CAMPUS" && context.campusKeys.includes(item.id));
    switch (scope) {
      case "GLOBAL": return true;
      case "CAMPUS": return context.scope === "CAMPUS" && ownCampus;
      case "APPLICABLE": return context.scope === "GLOBAL" || ownCampus;
      case "ACTIVE_APPLICABLE": return context.active && (context.scope === "GLOBAL" || ownCampus);
      case "OWNER": return ownCampus && (context.ownerId === principal.userId || context.collaboratorIds?.includes(principal.userId) === true);
      case "READABLE_RESOURCE": return context.readableResource === true;
      default: return false;
    }
  }
}
