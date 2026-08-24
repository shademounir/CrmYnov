import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AssignmentService } from "../assignment/assignment.service.js";
import { ReassignmentService } from "../assignment/reassignment.service.js";
import { AuditService } from "../audit/audit.service.js";
import { ClosureService } from "../closure/closure.service.js";
import { FollowUpService } from "../follow-up/follow-up.service.js";
import { IngestionService } from "../ingestion/ingestion.service.js";
import { LeadService } from "../leads/lead.service.js";
import { matchesInteractiveFilters, sourceChannel, type InteractiveReportingQuery } from "./reporting-filter.js";

export const OPERATIONAL_RISK_VERSION = "operational-risk-v1";
const interactionTypes = new Set(["CRM_CALL", "EXTERNAL_CALL", "PHONE_CALL", "PHYSICAL_VISIT", "WHATSAPP", "MANUAL_EMAIL", "MEETING"]);
export interface OperationalRiskQuery extends InteractiveReportingQuery {
  noInteractionHours?: string; capacityWarningPercent?: string; loadGap?: string; sourceRiskPercent?: string; minSourceVolume?: string;
}
export interface OperationalAlert {
  code: string; severity: "INFO" | "WARNING" | "CRITICAL"; count: number; reason: string; drillDown: string;
}
export interface OperationalRiskReport {
  definitionVersion: string; generatedAt: string; timezone: "Africa/Casablanca";
  thresholds: { noInteractionHours: number; capacityWarningPercent: number; loadGap: number; sourceRiskPercent: number; minSourceVolume: number };
  queues: { unassigned: number; withoutFirstInteraction: number; overdueFollowUps: number; pendingClosures: number; pendingReassignments: number };
  capacity: Array<{ adviserId: string; activeLeads: number; capacity: number; utilizationPercent: number }>;
  sourceRisks: Array<{ source: string; volume: number; rejectedOrReview: number; rate: number }>;
  alerts: OperationalAlert[]; safeguards: { disciplinaryScore: false; financialDecision: false };
}

@Injectable()
export class OperationalRiskService {
  constructor(
    private readonly leads: LeadService, private readonly followUps: FollowUpService, private readonly closures: ClosureService,
    private readonly reassignments: ReassignmentService, private readonly assignments: AssignmentService,
    private readonly ingestion: IngestionService, private readonly audit: AuditService,
  ) {}

  read(query: OperationalRiskQuery, principal: Principal, correlationId: string, now = new Date()): OperationalRiskReport {
    this.assertManager(principal);
    const from = this.boundary(query.from, "operational_from_invalid");
    const to = this.boundary(query.to, "operational_to_invalid");
    if (from && to && from >= to) throw new BadRequestException({ code: "operational_period_invalid" });
    const thresholds = {
      noInteractionHours: this.integer(query.noInteractionHours, 24, 1, 720, "operational_no_interaction_threshold_invalid"),
      capacityWarningPercent: this.integer(query.capacityWarningPercent, 90, 50, 100, "operational_capacity_threshold_invalid"),
      loadGap: this.integer(query.loadGap, 5, 1, 100, "operational_load_gap_invalid"),
      sourceRiskPercent: this.integer(query.sourceRiskPercent, 30, 1, 100, "operational_source_threshold_invalid"),
      minSourceVolume: this.integer(query.minSourceVolume, 3, 1, 1000, "operational_source_volume_invalid"),
    };
    const normalized = { ...query, ...(from ? { from } : {}), ...(to ? { to } : {}) };
    const rows = this.leads.reportingSnapshot(principal).filter((lead) => matchesInteractiveFilters(lead, normalized));
    const leadIds = new Set(rows.map((row) => row.id));
    const active = rows.filter((row) => row.status !== "ENROLLED" && row.status !== "CLOSED_LOST");
    const cutoff = now.valueOf() - thresholds.noInteractionHours * 3_600_000;
    const withoutFirstInteraction = active.filter((row) => new Date(row.createdAt).valueOf() <= cutoff
      && !row.activities.some((activity) => interactionTypes.has(activity.type))).length;
    const followUps = this.followUps.reportingSnapshot(principal).filter((item) => leadIds.has(item.leadId));
    const overdueFollowUps = followUps.filter((item) => (item.state === "DUE" || item.state === "SCHEDULED") && new Date(item.dueAt) < now).length;
    const pendingClosures = this.closures.list(principal).filter((item) => leadIds.has(item.leadId) && item.state === "PENDING").length;
    const pendingReassignments = this.reassignments.reportingSnapshot(principal).filter((item) => leadIds.has(item.leadId) && item.status === "PENDING").length;
    const visibleOwners = new Set(active.flatMap((row) => row.assignedToId ? [row.assignedToId] : []));
    const candidateCapacity = new Map<string, number>();
    for (const rule of this.assignments.listRules().filter((item) => item.enabled)) for (const candidate of rule.candidates) {
      if (visibleOwners.has(candidate.userId)) candidateCapacity.set(candidate.userId, Math.max(candidateCapacity.get(candidate.userId) ?? 0, candidate.capacity));
    }
    const capacity = [...visibleOwners].sort((a, b) => a.localeCompare(b, "en")).map((adviserId) => {
      const activeLeads = active.filter((row) => row.assignedToId === adviserId).length;
      const configured = candidateCapacity.get(adviserId) ?? 0;
      return { adviserId, activeLeads, capacity: configured, utilizationPercent: configured ? Number((activeLeads / configured * 100).toFixed(2)) : 100 };
    });
    const occurrences = this.ingestion.reportingSnapshot(principal).filter((item) => (!from || item.receivedAt >= from) && (!to || item.receivedAt < to)
      && (!query.campus || (item.campus ?? "UNSPECIFIED").localeCompare(query.campus, "fr", { sensitivity: "accent" }) === 0)
      && (!query.campaign || (item.campaign ?? "UNSPECIFIED") === query.campaign) && (!query.program || (item.program ?? "UNSPECIFIED") === query.program)
      && (!query.source || item.source === query.source) && (!query.channel || sourceChannel(item.source) === query.channel)
      && (!item.leadId ? !query.adviserId && !query.status : leadIds.has(item.leadId)));
    const sourceRisks = [...new Set(occurrences.map((item) => item.source))].sort((a, b) => a.localeCompare(b, "en")).flatMap((source) => {
      const group = occurrences.filter((item) => item.source === source); const rejectedOrReview = group.filter((item) => item.outcome === "INVALID" || item.outcome === "MANUAL_REVIEW").length;
      const rate = Number((rejectedOrReview / group.length * 100).toFixed(2));
      return group.length >= thresholds.minSourceVolume && rate >= thresholds.sourceRiskPercent ? [{ source, volume: group.length, rejectedOrReview, rate }] : [];
    });
    const queues = { unassigned: active.filter((row) => !row.assignedToId).length, withoutFirstInteraction, overdueFollowUps, pendingClosures, pendingReassignments };
    const alerts = this.alerts(queues, capacity, sourceRisks, thresholds);
    const report: OperationalRiskReport = { definitionVersion: OPERATIONAL_RISK_VERSION, generatedAt: now.toISOString(), timezone: "Africa/Casablanca",
      thresholds, queues, capacity, sourceRisks, alerts, safeguards: { disciplinaryScore: false, financialDecision: false } };
    this.audit.record({ eventType: "OPERATIONAL_RISK_VIEWED", actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId,
      correlationId, after: { definitionVersion: OPERATIONAL_RISK_VERSION, alertCount: alerts.length, thresholds }, result: "SUCCESS",
      idempotencyKey: `operational-risk:${randomUUID()}` });
    return report;
  }

  private alerts(queues: OperationalRiskReport["queues"], capacity: OperationalRiskReport["capacity"], sourceRisks: OperationalRiskReport["sourceRisks"], thresholds: OperationalRiskReport["thresholds"]): OperationalAlert[] {
    const alerts: OperationalAlert[] = [];
    const add = (code: string, count: number, drillDown: string, reason: string, severity: OperationalAlert["severity"] = "WARNING"): void => { if (count) alerts.push({ code, count, drillDown, reason, severity }); };
    add("unassigned_leads", queues.unassigned, "/leads?view=UNASSIGNED", "active lead has no primary adviser", "CRITICAL");
    add("first_interaction_overdue", queues.withoutFirstInteraction, "/leads?view=NO_ACTIVITY", `no structured interaction within ${thresholds.noInteractionHours} hours`);
    add("follow_up_overdue", queues.overdueFollowUps, "/leads?view=FOLLOW_UP", "scheduled follow-up due date is in the past", "CRITICAL");
    add("closure_decision_pending", queues.pendingClosures, "/manager/closures", "controlled closure awaits a Manager/Admin decision", "INFO");
    add("reassignment_decision_pending", queues.pendingReassignments, "/manager/assignment", "reassignment awaits a Manager/Admin decision", "INFO");
    for (const item of capacity.filter((row) => row.utilizationPercent >= thresholds.capacityWarningPercent)) add(`capacity_warning:${item.adviserId}`, item.activeLeads, `/leads?assignedToId=${encodeURIComponent(item.adviserId)}`, `configured capacity utilization is ${item.utilizationPercent}%`);
    if (capacity.length > 1) { const loads = capacity.map((item) => item.activeLeads); const gap = Math.max(...loads) - Math.min(...loads); add("load_gap", gap >= thresholds.loadGap ? gap : 0, "/manager/reports/commercial-performance", `active load difference meets the explicit ${thresholds.loadGap} lead threshold`, "INFO"); }
    for (const item of sourceRisks) add(`source_quality:${item.source}`, item.rejectedOrReview, `/leads?source=${encodeURIComponent(item.source)}`, `structured rejection or review rate is ${item.rate}%`);
    return alerts.sort((a, b) => a.code.localeCompare(b.code, "en"));
  }
  private integer(value: string | undefined, fallback: number, min: number, max: number, code: string): number { const parsed = value === undefined ? fallback : Number(value); if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new BadRequestException({ code }); return parsed; }
  private boundary(value: string | undefined, code: string): string | undefined { if (!value) return undefined; const parsed = new Date(value); if (Number.isNaN(parsed.valueOf())) throw new BadRequestException({ code }); return parsed.toISOString(); }
  private assertManager(principal: Principal): void { if (!principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "operational_reporting_role_required" }); }
}
