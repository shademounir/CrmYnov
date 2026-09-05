import { Inject, Injectable } from "@nestjs/common";
import type { SavedLeadViewShare } from "@prisma/client";
import type { Principal } from "../auth/auth.types.js";
import type { PermissionTransaction } from "../permissions/dynamic-repository.js";
import { PermissionService, type ResourceContext } from "../permissions/permission.service.js";
import { canonicalCampus } from "../permissions/dynamic-resources.js";
import { missingView, type Audience } from "./view-sharing.contract.js";
import { canonicalAudienceCampusIds } from "./view-sharing-campus.js";

export interface ResolvedAudience extends Audience { resource: ResourceContext; member: boolean; manager: boolean }
export function mutatingRole(principal: Principal): boolean { return principal.roles.some((role) => ["SUPER_ADMIN", "ADMIN", "MANAGER", "ADMISSIONS"].includes(role)); }

@Injectable()
export class ViewSharingAudiences {
  constructor(@Inject(PermissionService) private readonly permissions: PermissionService) {}

  async resolve(tx: PermissionTransaction, principal: Principal, kind: "TEAM" | "CAMPUS", id: string): Promise<ResolvedAudience> {
    const responsibility = kind === "TEAM" ? await tx.teamResponsibility.findUnique({ where: { id } }) : null;
    if (kind === "TEAM" && !responsibility?.active) missingView();
    const campus = await canonicalCampus(tx, responsibility?.campusId ?? id);
    const inCampus = principal.roles.includes("SUPER_ADMIN") || principal.scopes.some((scope) => scope.kind === "CAMPUS" && campus.keys.includes(scope.id));
    if (!inCampus) missingView();
    if (!responsibility) return { kind, id, campusId: campus.id, label: campus.keys[1] ?? campus.id, member: true, manager: false, resource: { scope: "CAMPUS", campusKeys: campus.keys, active: true } };
    const manager = await tx.collaborator.findUnique({ where: { id: responsibility.managerId } });
    if (!manager?.active || !manager.roles.includes("MANAGER") || !manager.campusId || !campus.keys.includes(manager.campusId)) missingView();
    const member = await tx.collaborator.findFirst({ where: { active: true, teamId: responsibility.teamId, campusId: { in: campus.keys } }, select: { id: true } });
    if (!member) missingView();
    const isMember = principal.scopes.some((scope) => scope.kind === "TEAM" && scope.id === responsibility.teamId);
    const isManager = responsibility.managerId === principal.userId && principal.roles.includes("MANAGER");
    return { kind, id, campusId: campus.id, label: responsibility.teamId, member: isMember || isManager, manager: isManager,
      resource: { scope: "CAMPUS", campusKeys: campus.keys, active: true, ownerId: member.id } };
  }

  async canShare(principal: Principal, audience: ResolvedAudience): Promise<boolean> {
    if (!mutatingRole(principal)) return false;
    const administrative = principal.roles.some((role) => role === "SUPER_ADMIN" || role === "ADMIN");
    if (audience.kind === "TEAM" && !administrative) {
      const governedMember = principal.roles.includes("ADMISSIONS") && audience.member;
      if (!audience.manager && !governedMember) return false;
    }
    return this.permissions.can(principal, `lead.views.share.${audience.kind.toLowerCase()}`, audience.resource);
  }

  async canRevoke(principal: Principal, audience: ResolvedAudience, ownerId: string): Promise<boolean> {
    if (!mutatingRole(principal)) return false;
    if (ownerId === principal.userId && await this.permissions.can(principal, "lead.views.revoke.own", { ...audience.resource, ownerId })) return true;
    if (principal.roles.some((role) => role === "SUPER_ADMIN" || role === "ADMIN")) return this.permissions.can(principal, "lead.views.revoke.campus", audience.resource);
    return audience.kind === "TEAM" && audience.manager && this.permissions.can(principal, "lead.views.revoke.team", audience.resource);
  }

  async shareAudience(tx: PermissionTransaction, principal: Principal, share: SavedLeadViewShare): Promise<ResolvedAudience> {
    if (share.kind !== "TEAM" && share.kind !== "CAMPUS") missingView();
    return this.resolve(tx, principal, share.kind, share.responsibilityId ?? share.campusId);
  }

  async list(tx: PermissionTransaction, principal: Principal): Promise<Audience[]> {
    const campusIds = await canonicalAudienceCampusIds(tx, principal);
    if (campusIds?.length === 0) return [];
    const campuses = await tx.crmReference.findMany({ where: { kind: "CAMPUS", state: "ACTIVE", ...(campusIds === null ? {} : { id: { in: campusIds } }) }, orderBy: { id: "asc" } });
    const result: Audience[] = [];
    for (const campus of campuses) {
      const audience = await this.resolve(tx, principal, "CAMPUS", campus.id);
      if (await this.canShare(principal, audience)) result.push(this.summary(audience));
      const responsibilities = await tx.teamResponsibility.findMany({ where: { active: true, campusId: campus.id }, orderBy: { id: "asc" } });
      for (const row of responsibilities) {
        const team = await this.resolve(tx, principal, "TEAM", row.id);
        if (await this.canShare(principal, team)) result.push(this.summary(team));
      }
    }
    return result;
  }

  private summary(value: ResolvedAudience): Audience { return { kind: value.kind, id: value.id, campusId: value.campusId, label: value.label }; }
}
