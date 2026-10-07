import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { Principal } from "../auth/auth.types.js";
import { ReassignmentService } from "../assignment/reassignment.service.js";
import { ClosureService } from "../closure/closure.service.js";
import { FollowUpService } from "../follow-up/follow-up.service.js";
import { LeadService, type LeadAcquisitionKind, type LeadStatus } from "../leads/lead.service.js";
import { campusContext, currentPrincipal, permissionDenied, resourceEvaluationContext } from "../permissions/dynamic-context.js";
import { evaluatePermission, type EvaluationContext } from "../permissions/dynamic-evaluator.js";
import { DynamicPermissionRepository, type PermissionTransaction } from "../permissions/dynamic-repository.js";
import type { ConfigurationSnapshot } from "../permissions/dynamic-contract.js";
import { canonicalCampus } from "../permissions/dynamic-resources.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { matchesInteractiveFilters, normalizeReportingQuery, normalizeScopedReportingQuery, reportingScopeRequirements, type InteractiveReportingQuery } from "./reporting-filter.js";
import { withPilotageReportingScope } from "./reporting-authority.js";

export interface DashboardCapabilities {
  canCreateLead: boolean; canReadRecentLeads: boolean; canViewManagerDashboard: boolean;
  canViewPersonalDashboard: boolean; canViewPilotageDashboard: boolean; canExportReporting: boolean;
}
export interface RecentDashboardLeads {
  generatedAt: string; timezone: "Africa/Casablanca"; filters: InteractiveReportingQuery; limit: number;
  availability: "OBSERVED" | "UNAVAILABLE"; reason: string | null;
  leads: Array<{ id: string; leadCode: string; name: string; status: LeadStatus; createdAt: string; acquisitionKind: LeadAcquisitionKind; assignedToLabel?: string }>;
  capabilities: DashboardCapabilities;
}

export interface CountObservability {
  state: "OBSERVED" | "AUTHORIZED_SUBSET" | "UNAVAILABLE";
  reason: string | null;
}
export interface PersistentReportingEvidence {
  source: "POSTGRESQL" | "LOCAL_SYNTHETIC_FALLBACK";
  generatedAt: string;
  snapshotConsistency: "COMPOSITIONAL_READ_COMMITTED" | "LOCAL_SYNTHETIC";
  distinctLeadCount: number | null;
  appointmentCount: number | null;
  documentMetadataCount: number | null;
  importBatchCount: number | null;
  countsObservability: Record<"distinctLeadCount" | "appointmentCount" | "documentMetadataCount" | "importBatchCount", CountObservability>;
  cohortBound: { leads: "AUTHORIZED_LEADS_CREATED_IN_PERIOD"; appointments: "ALL_STATES_LINKED_TO_AUTHORIZED_COHORT"; documents: "METADATA_LINKED_TO_AUTHORIZED_COHORT"; imports: "BATCHES_IMPORTED_IN_PERIOD_WITH_AUTHORIZED_LEAD_PROVENANCE"; channel: "BACKEND_SOURCE_MAPPING" };
  filterNormalizations: Array<{ field: "campus"; requested: string; applied: string; source: "PERSISTED_CAMPUS_REFERENCE" }>;
}
interface AuthorizedRead { tx: PermissionTransaction; snapshots: ConfigurationSnapshot[]; requiredKeys: readonly string[]; appointmentIds: ReadonlySet<string>; importIds: ReadonlySet<string>; normalizations: PersistentReportingEvidence["filterNormalizations"] }
const cohortBound: PersistentReportingEvidence["cohortBound"] = {
  leads: "AUTHORIZED_LEADS_CREATED_IN_PERIOD", appointments: "ALL_STATES_LINKED_TO_AUTHORIZED_COHORT",
  documents: "METADATA_LINKED_TO_AUTHORIZED_COHORT", imports: "BATCHES_IMPORTED_IN_PERIOD_WITH_AUTHORIZED_LEAD_PROVENANCE", channel: "BACKEND_SOURCE_MAPPING",
};

@Injectable()
export class ReportingPersistenceService {
  private readonly authorizedReads = new WeakMap<Principal, AuthorizedRead>();
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LeadService) private readonly leads: LeadService,
    @Inject(ReassignmentService) private readonly reassignments: ReassignmentService,
    @Inject(FollowUpService) private readonly followUps: FollowUpService,
    @Inject(ClosureService) private readonly closures: ClosureService,
    @Inject(DynamicPermissionRepository) private readonly permissions: DynamicPermissionRepository,
  ) {}

  async refresh(): Promise<void> {
    await Promise.all([this.leads.refreshReportingForApi(), this.reassignments.refreshReportingForApi(),
      this.followUps.refreshReportingForApi(), this.closures.refreshReportingForApi()]);
  }

  /** Reuse the request's permission fence, current session and persisted grants.
   * Reads compose current projections; this is not a RepeatableRead snapshot. */
  async withReportingScope<T>(actor: Principal, action: (principal: Principal) => T | Promise<T>, additionalKeys: readonly string[] | ((principal: Principal) => readonly string[]) = []): Promise<T> {
    if (!this.prisma.client) {
      const keys = typeof additionalKeys === "function" ? additionalKeys(actor) : additionalKeys;
      if (keys.includes("reporting.pilotage.view") && !actor.roles.some((role) => ["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(role))) permissionDenied();
      await this.refresh(); return action(actor);
    }
    return this.permissions.readTransaction(async (tx) => {
      const current = await currentPrincipal(tx, actor);
      const snapshots = await this.permissions.snapshots(tx);
      const keys = typeof additionalKeys === "function" ? additionalKeys(current) : additionalKeys;
      const requiredKeys = [...new Set(["reporting.view", "lead.view", ...keys])];
      const global = current.roles.includes("SUPER_ADMIN") && current.scopes.some((scope) => scope.kind === "GLOBAL");
      const campusKeys = new Set<string>();
      for (const scope of current.scopes) if (scope.kind === "CAMPUS" && !campusKeys.has(scope.id)) {
        const campus = await canonicalCampus(tx, scope.id);
        for (const key of campus.keys) campusKeys.add(key);
      }
      const rows = await tx.lead.findMany({ where: global ? {} : { campus: { in: [...campusKeys] } },
        select: { id: true, campus: true, assignedToId: true, collaborators: { where: { active: true }, select: { userId: true } } } });
      const leadIds = new Set<string>(); const appointmentIds = new Set<string>(); const importIds = new Set<string>();
      const campuses = new Map<string, Awaited<ReturnType<typeof canonicalCampus>>>();
      for (const row of rows) {
        if (actor.permissionLeadIds && !actor.permissionLeadIds.has(row.id)) continue;
        const campus = campuses.get(row.campus) ?? await canonicalCampus(tx, row.campus); campuses.set(row.campus, campus);
        const context = await resourceEvaluationContext(tx, current, { scope: "CAMPUS", campusKeys: campus.keys, active: true,
          ...(row.assignedToId ? { ownerId: row.assignedToId } : {}), collaboratorIds: row.collaborators.map((item) => item.userId), readableResource: true });
        if (!requiredKeys.every((key) => evaluatePermission(current, key, snapshots, context).allowed)) continue;
        leadIds.add(row.id);
        if (evaluatePermission(current, "appointment.manage", snapshots, context).allowed) appointmentIds.add(row.id);
        if (evaluatePermission(current, "import.view", snapshots, context).allowed) importIds.add(row.id);
      }
      // A revoked capability is not an observed empty cohort, even on an empty database.
      if (!leadIds.size && !await this.hasCapability(tx, current, snapshots, requiredKeys)) permissionDenied();
      const scoped: Principal = { ...current, permissionLeadIds: leadIds };
      await this.refresh();
      this.authorizedReads.set(scoped, { tx, snapshots, requiredKeys, appointmentIds, importIds, normalizations: [] });
      try {
        return keys.includes("reporting.pilotage.view") ? await withPilotageReportingScope(scoped, () => action(scoped)) : await action(scoped);
      } finally { this.authorizedReads.delete(scoped); }
    });
  }

  async normalizeCampusQuery<T extends InteractiveReportingQuery>(principal: Principal, query: T): Promise<T> {
    const authorized = this.authorizedReads.get(principal);
    if (!query.campus || !this.prisma.client) return query;
    if (!authorized) throw new ServiceUnavailableException({ code: "reporting_scope_unavailable" });
    const campus = await canonicalCampus(authorized.tx, query.campus);
    const contexts = await this.campusCapabilityContexts(authorized.tx, principal, campus.keys);
    if (!contexts.some((context) => authorized.requiredKeys.every((key) => evaluatePermission(principal, key, authorized.snapshots, context).allowed))) permissionDenied();
    const code = campus.keys[1]; if (!code) permissionDenied();
    if (query.campus !== code && !authorized.normalizations.some((item) => item.requested === query.campus)) {
      authorized.normalizations.push({ field: "campus", requested: query.campus, applied: code, source: "PERSISTED_CAMPUS_REFERENCE" });
    }
    return { ...query, campus: code };
  }

  async capabilities(principal: Principal, query: InteractiveReportingQuery): Promise<DashboardCapabilities> {
    const authorized = this.authorizedReads.get(principal);
    if (!authorized) return { canCreateLead: false, canReadRecentLeads: false, canViewManagerDashboard: false, canViewPersonalDashboard: false, canViewPilotageDashboard: false, canExportReporting: false };
    const normalized = await this.normalizeCampusQuery(principal, query);
    const values = normalized.campus ? [normalized.campus] : principal.roles.includes("SUPER_ADMIN")
      ? (await authorized.tx.crmReference.findMany({ where: { kind: "CAMPUS", state: "ACTIVE" }, select: { id: true } })).map((row) => row.id)
      : principal.scopes.flatMap((scope) => scope.kind === "CAMPUS" ? [scope.id] : []);
    const globalReportAllowed = Boolean(normalized.campus) || !principal.roles.includes("SUPER_ADMIN")
      || evaluatePermission(principal, "reporting.global.view", authorized.snapshots, campusContext(principal, "GLOBAL")).allowed;
    const legacyPersonalRole = principal.roles.some((role) => ["ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN"].includes(role));
    const seen = new Set<string>(); let canCreateLead = false; let canReadRecentLeads = false; let canViewManagerDashboard = false; let canExportReporting = false;
    for (const value of values) {
      if (seen.has(value)) continue;
      const campus = await canonicalCampus(authorized.tx, value); campus.keys.forEach((key) => seen.add(key));
      const contexts = await this.campusCapabilityContexts(authorized.tx, principal, campus.keys);
      const can = (keys: readonly string[]): boolean => contexts.some((context) => keys.every((key) => evaluatePermission(principal, key, authorized.snapshots, context).allowed));
      canCreateLead ||= principal.roles.some((role) => ["ADMISSIONS", "ADMIN", "SUPER_ADMIN"].includes(role)) && can(["lead.create"]);
      const pilotage = globalReportAllowed && can(["reporting.view", "reporting.pilotage.view", "lead.view"]);
      canReadRecentLeads ||= globalReportAllowed && can(["reporting.view", "lead.view"]) && (legacyPersonalRole || pilotage);
      canViewManagerDashboard ||= pilotage;
      canExportReporting ||= globalReportAllowed && can(["reporting.view", "reporting.pilotage.view", "lead.view", "reporting.export"]);
    }
    return { canCreateLead, canReadRecentLeads, canViewManagerDashboard, canViewPersonalDashboard: legacyPersonalRole && canReadRecentLeads, canViewPilotageDashboard: canViewManagerDashboard, canExportReporting };
  }

  /** Read-only shell capability: absence of reporting access must not hide an
   * independently authorized lead.create action. No identity comes from raw. */
  async dashboardCapabilities(actor: Principal, raw: Record<string, string | undefined>): Promise<DashboardCapabilities> {
    if (Object.keys(raw).some((key) => key !== "campus")) throw new BadRequestException({ code: "reporting_capability_filter_unknown" });
    return this.permissions.readTransaction(async (tx) => {
      const current = await currentPrincipal(tx, actor);
      const query = normalizeReportingQuery(raw, current);
      const snapshots = await this.permissions.snapshots(tx);
      const scoped: Principal = { ...current };
      this.authorizedReads.set(scoped, { tx, snapshots, requiredKeys: [], appointmentIds: new Set(), importIds: new Set(), normalizations: [] });
      try { return await this.capabilities(scoped, query); } finally { this.authorizedReads.delete(scoped); }
    });
  }

  private async campusCapabilityContexts(tx: PermissionTransaction, principal: Principal, campusKeys: readonly string[]): Promise<EvaluationContext[]> {
    // TEAM capability is witnessed by real active owners and the existing
    // responsibility lookup; never by setting team/managedTeam=true artificially.
    const owners = await tx.collaborator.findMany({ where: { active: true, campusId: { in: [...campusKeys] } }, select: { id: true } });
    return Promise.all([...new Set([principal.userId, ...owners.map((owner) => owner.id)])].map((ownerId) =>
      resourceEvaluationContext(tx, principal, { scope: "CAMPUS", campusKeys, active: true, ownerId })));
  }

  private async hasCapability(tx: PermissionTransaction, principal: Principal, snapshots: ConfigurationSnapshot[], keys: readonly string[]): Promise<boolean> {
    const values = principal.roles.includes("SUPER_ADMIN")
      ? (await tx.crmReference.findMany({ where: { kind: "CAMPUS", state: "ACTIVE" }, select: { id: true } })).map((row) => row.id)
      : principal.scopes.flatMap((scope) => scope.kind === "CAMPUS" ? [scope.id] : []);
    for (const value of [...new Set(values)]) {
      const campus = await canonicalCampus(tx, value);
      const contexts = await this.campusCapabilityContexts(tx, principal, campus.keys);
      if (contexts.some((context) => keys.every((key) => evaluatePermission(principal, key, snapshots, context).allowed))) return true;
    }
    if (!values.length && principal.roles.includes("SUPER_ADMIN")) {
      const context = await resourceEvaluationContext(tx, principal, { scope: "GLOBAL", campusKeys: [], active: true });
      return keys.every((key) => evaluatePermission(principal, key, snapshots, context).allowed);
    }
    return false;
  }

  async recentLeads(actor: Principal, raw: Record<string, string | undefined>, limit = 5, now = new Date()): Promise<RecentDashboardLeads> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new BadRequestException({ code: "reporting_recent_limit_invalid" });
    return this.withReportingScope(actor, async (principal) => {
      const canonical = await this.normalizeCampusQuery(principal, raw);
      // The personal dashboard always represents this user, including for Managers.
      const query = normalizeScopedReportingQuery(canonical, principal, now);
      const capabilities = await this.capabilities(principal, query);
      const authorized = this.authorizedReads.get(principal);
      if (!authorized) return { generatedAt: now.toISOString(), timezone: "Africa/Casablanca", filters: query, limit, leads: [], capabilities, availability: "UNAVAILABLE", reason: "POSTGRESQL_NOT_CONFIGURED" };
      if (!capabilities.canReadRecentLeads) permissionDenied();
      const ids = this.leads.reportingSnapshot(principal).filter((lead) => matchesInteractiveFilters(lead, query))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id)).slice(0, limit).map((lead) => lead.id);
      const rows = await authorized.tx.lead.findMany({ where: { id: { in: ids } }, select: { id: true, leadCode: true, firstName: true, lastName: true, status: true, createdAt: true, assignedToId: true, acquisitionKind: true } });
      const owners = await authorized.tx.collaborator.findMany({ where: { id: { in: rows.flatMap((row) => row.assignedToId ? [row.assignedToId] : []) } }, select: { id: true, professionalDisplayName: true } });
      const labels = new Map(owners.flatMap((owner) => owner.professionalDisplayName?.trim() ? [[owner.id, owner.professionalDisplayName.trim()] as const] : []));
      const byId = new Map(rows.map((row) => [row.id, row]));
      const leads = ids.flatMap((id) => {
        const row = byId.get(id); if (!row) return [];
        const label = row.assignedToId ? labels.get(row.assignedToId) : undefined;
        const acquisitionKind: LeadAcquisitionKind = row.acquisitionKind === "BASELINE" ? "BASELINE" : "NEW";
        return [{ id: row.id, leadCode: row.leadCode, name: `${row.firstName} ${row.lastName}`.trim(), status: row.status as LeadStatus, createdAt: row.createdAt.toISOString(), acquisitionKind, ...(label ? { assignedToLabel: label } : {}) }];
      });
      return { generatedAt: now.toISOString(), timezone: "Africa/Casablanca", filters: query, limit, leads, capabilities, availability: "OBSERVED", reason: null };
    }, (current) => reportingScopeRequirements(raw, current));
  }

  async evidence(principal: Principal, query: InteractiveReportingQuery): Promise<PersistentReportingEvidence> {
    if (!this.prisma.client) {
      const unavailable: CountObservability = { state: "UNAVAILABLE", reason: "POSTGRESQL_NOT_CONFIGURED" };
      return { source: "LOCAL_SYNTHETIC_FALLBACK", generatedAt: new Date().toISOString(), snapshotConsistency: "LOCAL_SYNTHETIC",
        distinctLeadCount: null, appointmentCount: null, documentMetadataCount: null, importBatchCount: null,
        countsObservability: { distinctLeadCount: unavailable, appointmentCount: unavailable, documentMetadataCount: unavailable, importBatchCount: unavailable }, cohortBound, filterNormalizations: [] };
    }
    const authorized = this.authorizedReads.get(principal);
    if (!authorized) return this.withReportingScope(principal, (current) => this.evidence(current, query));
    const normalized = await this.normalizeCampusQuery(principal, query);
    const ids = this.leads.reportingSnapshot(principal).filter((lead) => matchesInteractiveFilters(lead, normalized)).map((lead) => lead.id);
    const appointmentIds = ids.filter((id) => authorized.appointmentIds.has(id));
    const importIds = ids.filter((id) => authorized.importIds.has(id));
    const observed: CountObservability = { state: "OBSERVED", reason: null };
    const observability = (allowed: readonly string[], permission: string): CountObservability => allowed.length === ids.length ? observed
      : { state: allowed.length ? "AUTHORIZED_SUBSET" : "UNAVAILABLE", reason: `${permission.toUpperCase().replaceAll(".", "_")}_RESTRICTED` };
    const appointmentObservation = observability(appointmentIds, "appointment.manage"); const importObservation = observability(importIds, "import.view");
    try {
      const [distinctLeadCount, appointmentCount, documentMetadataCount, importBatchCount] = await Promise.all([
        authorized.tx.lead.count({ where: { id: { in: ids } } }),
        appointmentObservation.state === "UNAVAILABLE" ? null : authorized.tx.appointment.count({ where: { leadId: { in: appointmentIds } } }),
        authorized.tx.candidateDocument.count({ where: { leadId: { in: ids } } }),
        importObservation.state === "UNAVAILABLE" ? null : authorized.tx.ingestionBatch.count({ where: {
          importedAt: { ...(normalized.from ? { gte: new Date(normalized.from) } : {}), ...(normalized.to ? { lt: new Date(normalized.to) } : {}) },
          provenances: { some: { leadId: { in: importIds } } },
        } }),
      ]);
      return { source: "POSTGRESQL", generatedAt: new Date().toISOString(), snapshotConsistency: "COMPOSITIONAL_READ_COMMITTED",
        distinctLeadCount, appointmentCount, documentMetadataCount, importBatchCount,
        countsObservability: { distinctLeadCount: observed, appointmentCount: appointmentObservation, documentMetadataCount: observed, importBatchCount: importObservation }, cohortBound,
        filterNormalizations: [...authorized.normalizations] };
    } catch { throw new ServiceUnavailableException({ code: "reporting_store_unavailable" }); }
  }
}
