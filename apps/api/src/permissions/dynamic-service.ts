import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { roles, type Principal, type Role } from "../auth/auth.types.js";
import { businessRoleLabels, type ResourceContext } from "./permission.service.js";
import { configurationKey, definition, GLOBAL_CAMPUS, historicalGrants, permissionCatalogue, scopeWithin, validateInput, validateTarget, type ConfigurationInput, type ConfigurationSnapshot, type ConfigurationTarget, type Grants } from "./dynamic-contract.js";
import { defaultConfiguration, evaluatePermission, resolveGrants, type PermissionDecision } from "./dynamic-evaluator.js";
import { DynamicPermissionRepository, type PermissionTransaction } from "./dynamic-repository.js";
import { campusContext, currentPrincipal, permissionDenied, resourceEvaluationContext } from "./dynamic-context.js";
import { canonicalCampus, leadResource } from "./dynamic-resources.js";
import type { CatalogueResponse, ConfigurationChange, ConfigurationResponse, EffectiveResponse, HistoryVersion, PreviewResponse, SaveResponse } from "./dynamic-responses.js";
import { saveResponsibility, validateResponsibility, type TeamResponsibilityInput, type TeamResponsibilityView } from "./dynamic-teams.js";

const descriptions: Record<Role, string> = {
  SUPER_ADMIN: "Administration globale, sous protection du dernier Super Admin.",
  ADMIN: "Administration des rôles inférieurs dans ses campus, sans auto-escalade.",
  MANAGER: "Management commercial ; TEAM exige une responsabilité d’équipe active explicite.",
  ADMISSIONS: "Conseiller commercial ; OWN signifie affecté ou collaborateur actif.",
  AUDITOR: "Lecteur structurellement non mutatif, sans refus imposé aux autres rôles.",
};

function requireAdmin(principal: Principal): void {
  if (!principal.roles.some((role) => role === "SUPER_ADMIN" || role === "ADMIN")) permissionDenied();
}
function campusIds(principal: Principal): string[] {
  return principal.scopes.flatMap((scope) => scope.kind === "CAMPUS" && /^[a-f\d-]{36}$/i.test(scope.id) ? [scope.id] : []);
}
async function knownCampus(tx: PermissionTransaction, campus: string): Promise<void> {
  if (campus === GLOBAL_CAMPUS) return;
  const row = await tx.crmReference.findUnique({ where: { id: campus } });
  if (row?.kind !== "CAMPUS" || row.state !== "ACTIVE") permissionDenied();
}
function visibleTarget(principal: Principal, target: ConfigurationTarget): void {
  validateTarget(target); requireAdmin(principal);
  if (principal.roles.includes("SUPER_ADMIN")) return;
  if (target.campus === GLOBAL_CAMPUS || !campusContext(principal, target.campus).campusAllowed) permissionDenied();
}
function editableTarget(principal: Principal, target: ConfigurationTarget): void {
  visibleTarget(principal, target);
  if (principal.roles.includes("SUPER_ADMIN")) return;
  if (target.kind !== "ROLE" || !["MANAGER", "ADMISSIONS", "AUDITOR"].includes(target.role) || principal.roles.includes(target.role as Role)) permissionDenied();
}
function requirePermission(principal: Principal, key: string, rows: ConfigurationSnapshot[], campus: string): void {
  if (!evaluatePermission(principal, key, rows, campusContext(principal, campus)).allowed) permissionDenied();
}
function assertCeilings(input: ConfigurationInput, rows: ConfigurationSnapshot[]): void {
  if (input.campus === GLOBAL_CAMPUS && input.kind === "CEILING") return;
  const ceiling = resolveGrants(rows, { kind: "CEILING", role: "*", campus: GLOBAL_CAMPUS });
  const role = input.kind === "ROLE" ? resolveGrants(rows, { kind: "ROLE", role: input.role, campus: GLOBAL_CAMPUS }) : ceiling;
  for (const [key, scope] of Object.entries(input.grants)) {
    if (!scopeWithin(scope, ceiling[key] ?? "NONE")) permissionDenied();
    if (input.campus !== GLOBAL_CAMPUS && !scopeWithin(scope, role[key] ?? "NONE")) permissionDenied();
  }
}
function assertAdminGrantBounds(actor: Principal, input: ConfigurationInput, rows: ConfigurationSnapshot[]): void {
  if (actor.roles.includes("SUPER_ADMIN")) return;
  // Configuring a scope uses administrative authority, not ownership of a business resource.
  // The closed registry calls this capability roles.permissions.manage (settings management).
  const authority = evaluatePermission(actor, "roles.permissions.manage", rows, campusContext(actor, input.campus));
  for (const [key, scope] of Object.entries(input.grants)) {
    if (scope === "NONE") continue;
    if (scope === "GLOBAL" || definition(key)?.reserved) permissionDenied();
    if (!authority.sources.some((source) => source.role === "ADMIN" && source.allowed &&
      [source.sourceScope, source.globalCeiling, source.campusCeiling, source.campusGrant].every((ceiling) => scopeWithin(scope, ceiling)))) permissionDenied();
  }
}
export function configurationChanges(before: Grants, after: Grants): ConfigurationChange[] {
  return Object.entries(after).filter(([key, scope]) => before[key] !== scope).map(([permission, to]) => ({
    permission, from: before[permission] ?? "NONE", to,
    widening: !scopeWithin(to, before[permission] ?? "NONE"), sensitive: definition(permission)?.sensitive === true,
  }));
}
@Injectable()
export class DynamicPermissionService {
  constructor(@Inject(DynamicPermissionRepository) private readonly repository: DynamicPermissionRepository) {}

  async decision(actor: Principal, key: string, resource: ResourceContext): Promise<PermissionDecision> {
    return this.repository.readTransaction(async (tx) => {
      const principal = await currentPrincipal(tx, actor);
      const rows = await this.repository.snapshots(tx);
      const context = await resourceEvaluationContext(tx, principal, resource);
      if (key === "lead.references.view" && resource.scope === "GLOBAL") {
        const campus = principal.scopes.find((scope) => scope.kind === "CAMPUS");
        if (campus?.kind === "CAMPUS") Object.assign(context, campusContext(principal, (await canonicalCampus(tx, campus.id)).id));
        context.active = resource.active || principal.roles.some((role) => ["ADMIN", "SUPER_ADMIN"].includes(role)) || resource.readableResource === true;
      }
      return evaluatePermission(principal, key, rows, context);
    });
  }
  async list(actor: Principal, requestedCampus?: string): Promise<CatalogueResponse> {
    return this.repository.readTransaction(async (tx) => {
      const principal = await currentPrincipal(tx, actor);
      const ownCampuses = campusIds(principal);
      const firstCampus = await tx.crmReference.findFirst({ where: { kind: "CAMPUS", state: "ACTIVE", id: { in: ownCampuses } }, select: { id: true } });
      const campus = requestedCampus ?? (principal.roles.includes("SUPER_ADMIN") ? GLOBAL_CAMPUS : firstCampus?.id ?? permissionDenied());
      await knownCampus(tx, campus);
      visibleTarget(principal, { kind: "CEILING", role: "*", campus });
      const rows = await this.repository.snapshots(tx);
      requirePermission(principal, "roles.permissions.view", rows, campus);
      const campusKeys = campus === GLOBAL_CAMPUS ? [] : (await canonicalCampus(tx, campus)).keys;
      const users = await tx.collaborator.findMany({ where: { active: true, ...(campus === GLOBAL_CAMPUS ? {} : { campusId: { in: campusKeys } }) }, select: { roles: true } });
      const campuses = await tx.crmReference.findMany({ where: { kind: "CAMPUS", state: "ACTIVE", ...(principal.roles.includes("SUPER_ADMIN") ? {} : { id: { in: campusIds(principal) } }) }, select: { id: true, code: true } });
      return { campus, catalogueVersion: 1, catalogue: permissionCatalogue, roles: roles.map((role) => ({
        role, label: businessRoleLabels[role], description: descriptions[role], users: users.filter((user) => user.roles.includes(role)).length,
        editable: principal.roles.includes("SUPER_ADMIN") || ["MANAGER", "ADMISSIONS", "AUDITOR"].includes(role) && !principal.roles.includes(role),
      })), campuses, global: principal.roles.includes("SUPER_ADMIN") };
    });
  }
  async read(actor: Principal, target: ConfigurationTarget): Promise<ConfigurationResponse> {
    return this.repository.readTransaction(async (tx) => {
      const principal = await currentPrincipal(tx, actor); visibleTarget(principal, target);
      await knownCampus(tx, target.campus);
      const rows = await this.repository.snapshots(tx); requirePermission(principal, "roles.permissions.view", rows, target.campus);
      const current = rows.find((row) => row.id === configurationKey(target));
      return { ...target, version: current?.version ?? 0, inherited: !current, grants: current?.grants ?? defaultConfiguration(target), globalCeiling: resolveGrants(rows, { kind: "CEILING", role: "*", campus: GLOBAL_CAMPUS }) };
    });
  }
  async preview(actor: Principal, input: ConfigurationInput): Promise<PreviewResponse> {
    validateInput(input);
    return this.repository.readTransaction(async (tx) => {
      const principal = await currentPrincipal(tx, actor), rows = await this.repository.snapshots(tx);
      await knownCampus(tx, input.campus);
      const before = this.validateChange(principal, input, rows);
      const campusKeys = input.campus === GLOBAL_CAMPUS ? [] : (await canonicalCampus(tx, input.campus)).keys;
      const users = await tx.collaborator.count({ where: { active: true, ...(input.role === "*" ? {} : { roles: { has: input.role } }), ...(input.campus === GLOBAL_CAMPUS ? {} : { campusId: { in: campusKeys } }) } });
      return { changes: configurationChanges(before, input.grants), affectedUsers: users, expectedVersion: input.expectedVersion, mutated: false };
    });
  }
  async save(actor: Principal, input: ConfigurationInput): Promise<SaveResponse> {
    validateInput(input);
    return this.repository.transaction(async (tx) => this.saveInTransaction(tx, actor, input));
  }
  private async saveInTransaction(tx: PermissionTransaction, actor: Principal, input: ConfigurationInput): Promise<SaveResponse> {
    const principal = await currentPrincipal(tx, actor), rows = await this.repository.snapshots(tx);
    await knownCampus(tx, input.campus);
    const before = this.validateChange(principal, input, rows);
    const changes = configurationChanges(before, input.grants);
    if (!changes.length) throw new ConflictException({ code: "permission_no_change" });
    if (changes.some((change) => change.widening || change.sensitive) && !input.confirmed) permissionDenied();
    const next = rows.filter((row) => row.id !== configurationKey(input));
    next.push({ ...input, id: configurationKey(input), version: input.expectedVersion + 1 });
    await this.protectLastSuperAdmin(tx, next);
    const version = await this.repository.append(tx, input, before, principal);
    return { version, changes, roles: principal.roles };
  }
  private validateChange(principal: Principal, input: ConfigurationInput, rows: ConfigurationSnapshot[]): Grants {
    editableTarget(principal, input); requirePermission(principal, "roles.permissions.manage", rows, input.campus);
    const current = rows.find((row) => row.id === configurationKey(input));
    if ((current?.version ?? 0) !== input.expectedVersion) throw new ConflictException({ code: "permission_version_conflict" });
    assertCeilings(input, rows); assertAdminGrantBounds(principal, input, rows);
    return current?.grants ?? defaultConfiguration(input);
  }
  private async protectLastSuperAdmin(tx: PermissionTransaction, rows: ConfigurationSnapshot[]): Promise<void> {
    const admins = await tx.collaborator.findMany({ where: { active: true, roles: { has: "SUPER_ADMIN" } }, select: { id: true, roles: true } });
    const remains = admins.some((admin) => {
      const principal: Principal = { userId: admin.id, roles: admin.roles as Role[], scopes: [{ kind: "GLOBAL" }], sessionId: "invariant-check" };
      return ["roles.permissions.view", "roles.permissions.manage"].every((key) => evaluatePermission(principal, key, rows, campusContext(principal, GLOBAL_CAMPUS)).allowed);
    });
    if (!remains) throw new ConflictException({ code: "last_super_admin_required" });
  }
  async history(actor: Principal, target: ConfigurationTarget): Promise<HistoryVersion[]> {
    return this.repository.readTransaction(async (tx) => {
      const principal = await currentPrincipal(tx, actor); visibleTarget(principal, target);
      await knownCampus(tx, target.campus);
      requirePermission(principal, "roles.permissions.view", await this.repository.snapshots(tx), target.campus);
      return tx.rolePermissionVersion.findMany({ where: { configurationId: configurationKey(target) }, orderBy: { number: "desc" }, take: 50, include: { grants: true, audits: { select: { actorId: true, actorRoles: true, reason: true, previous: true, next: true, createdAt: true } } } });
    });
  }
  async restore(actor: Principal, input: Omit<ConfigurationInput, "grants"> & { restoreVersion: number }): Promise<SaveResponse> {
    const allowed = ["kind", "role", "campus", "expectedVersion", "reason", "confirmed", "restoreVersion"];
    if (!input || typeof input !== "object" || Array.isArray(input)) permissionDenied();
    if (Object.keys(input).some((key) => !allowed.includes(key)) || !Number.isSafeInteger(input.restoreVersion) || input.restoreVersion < 1) permissionDenied();
    validateTarget(input);
    return this.repository.transaction(async (tx) => {
      const principal = await currentPrincipal(tx, actor); editableTarget(principal, input);
      const version = await tx.rolePermissionVersion.findUnique({ where: { configurationId_number: { configurationId: configurationKey(input), number: input.restoreVersion } }, include: { grants: true } });
      if (!version) permissionDenied();
      const grants = historicalGrants(Object.fromEntries(version.grants.map((grant) => [grant.permission, grant.scope])), input);
      const restored: ConfigurationInput = { kind: input.kind, role: input.role, campus: input.campus, expectedVersion: input.expectedVersion, confirmed: input.confirmed, reason: "RESTORE_VERSION", grants };
      validateInput(restored);
      return this.saveInTransaction(tx, principal, restored);
    });
  }
  async explain(actor: Principal, campus: string, leadId?: string): Promise<EffectiveResponse> {
    return this.repository.readTransaction(async (tx) => {
      const principal = await currentPrincipal(tx, actor), rows = await this.repository.snapshots(tx);
      await knownCampus(tx, campus);
      const context = leadId ? await resourceEvaluationContext(tx, principal, await leadResource(tx, leadId)) : campusContext(principal, campus);
      if (!context.campusAllowed && !context.globalAllowed) permissionDenied();
      if (leadId && !evaluatePermission(principal, "lead.view", rows, context).allowed) permissionDenied();
      return { catalogueVersion: 1, roles: principal.roles, permissions: permissionCatalogue.map((item) => evaluatePermission(principal, item.key, rows, context)), businessRules: "Les validations Manager, clôtures, archives et droits réservés restent applicables à chaque action." };
    });
  }
  async teamResponsibilities(actor: Principal, input?: TeamResponsibilityInput): Promise<{ responsibilities: TeamResponsibilityView[] }> {
    if (input !== undefined) validateResponsibility(input);
    return this.repository.transaction(async (tx) => {
      const principal = await currentPrincipal(tx, actor);
      if (!principal.roles.includes("SUPER_ADMIN")) permissionDenied();
      const rows = await this.repository.snapshots(tx);
      requirePermission(principal, input ? "users.roles.assign" : "users.view", rows, GLOBAL_CAMPUS);
      requirePermission(principal, input ? "roles.permissions.manage" : "roles.permissions.view", rows, GLOBAL_CAMPUS);
      if (input) await saveResponsibility(tx, principal, input);
      return { responsibilities: await tx.teamResponsibility.findMany({ select: { id: true, teamId: true, campusId: true, managerId: true, active: true, version: true }, orderBy: [{ teamId: "asc" }, { managerId: "asc" }] }) };
    }, input ? "write" : "read");
  }
}
