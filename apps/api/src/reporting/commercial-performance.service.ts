import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { ReassignmentService } from "../assignment/reassignment.service.js";
import { FollowUpService } from "../follow-up/follow-up.service.js";
import { LeadService, type LeadReportingRow } from "../leads/lead.service.js";

export const COMMERCIAL_PERFORMANCE_VERSION = "commercial-performance-v1";
export const COMMERCIAL_PERFORMANCE_TIMEZONE = "Africa/Casablanca";

export interface CommercialPerformanceQuery {
  from?: string; to?: string; campus?: string; inactivityHours?: string;
}

export interface AdviserPerformance {
  adviserId: string;
  primaryLeadCount: number;
  secondaryLeadCount: number;
  statusVolumes: { contacted: number; qualified: number; enrolled: number; closedLost: number };
  rates: { contact: number | null; qualification: number | null; enrollment: number | null; loss: number | null };
  medianMinutes: { firstHandling: number | null; contactToQualification: number | null; qualificationToEnrollment: number | null };
  followUps: { planned: number; completed: number; overdue: number; cancelled: number };
  inactiveLeadCount: number;
  activeLoad: number;
  reassignments: { requested: number; approved: number; rejected: number };
  drillDown: { assigned: string; overdue: string; inactive: string };
}

export interface CommercialPerformanceReport {
  definitionVersion: string; timezone: string; generatedAt: string;
  cohort: { from?: string; to?: string; inactivityHours: number; uniqueLeadCount: number };
  advisers: AdviserPerformance[];
  definitions: Array<{ key: string; numerator: string; denominator: string; inclusions: string[]; exclusions: string[] }>;
}

const handlingTypes = new Set(["CRM_CALL", "EXTERNAL_CALL", "PHONE_CALL", "PHYSICAL_VISIT", "WHATSAPP", "MANUAL_EMAIL", "MEETING"]);

@Injectable()
export class CommercialPerformanceService {
  constructor(
    private readonly leads: LeadService,
    private readonly followUps: FollowUpService,
    private readonly reassignments: ReassignmentService,
    private readonly audit: AuditService,
  ) {}

  read(query: CommercialPerformanceQuery, principal: Principal, correlationId: string, now = new Date()): CommercialPerformanceReport {
    const from = this.boundary(query.from, "performance_from_invalid");
    const to = this.boundary(query.to, "performance_to_invalid");
    if (from && to && from >= to) throw new BadRequestException({ code: "performance_period_invalid" });
    const inactivityHours = query.inactivityHours === undefined ? 72 : Number(query.inactivityHours);
    if (!Number.isInteger(inactivityHours) || inactivityHours < 1 || inactivityHours > 2160) {
      throw new BadRequestException({ code: "performance_inactivity_threshold_invalid" });
    }
    const campus = query.campus?.trim();
    const rows = this.leads.reportingSnapshot(principal).filter((lead) =>
      (!from || lead.createdAt >= from) && (!to || lead.createdAt < to)
      && (!campus || lead.campus.localeCompare(campus, "fr", { sensitivity: "accent" }) === 0));
    const unique = new Map(rows.map((row) => [row.id, row]));
    const cohort = [...unique.values()];
    const adviserOnly = principal.roles.includes("ADMISSIONS")
      && !principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN");
    const adviserIds = new Set<string>();
    for (const lead of cohort) {
      if (lead.assignedToId) adviserIds.add(lead.assignedToId);
      for (const collaboratorId of lead.collaboratorIds) adviserIds.add(collaboratorId);
    }
    if (adviserOnly) { adviserIds.clear(); adviserIds.add(principal.userId); }
    const followUps = this.followUps.reportingSnapshot(principal);
    const reassignments = this.reassignments.reportingSnapshot(principal);
    const inactiveBefore = new Date(now.valueOf() - inactivityHours * 3_600_000).toISOString();
    const advisers = [...adviserIds].sort((left, right) => left.localeCompare(right, "en")).map((adviserId) => {
      const primary = cohort.filter((lead) => lead.assignedToId === adviserId);
      const secondary = cohort.filter((lead) => lead.assignedToId !== adviserId && lead.collaboratorIds.includes(adviserId));
      const contacted = primary.filter((lead) => this.reached(lead, "CONTACTED")).length;
      const qualified = primary.filter((lead) => this.reached(lead, "QUALIFIED")).length;
      const enrolled = primary.filter((lead) => this.reached(lead, "ENROLLED")).length;
      const closedLost = primary.filter((lead) => lead.status === "CLOSED_LOST").length;
      const adviserFollowUps = followUps.filter((item) => item.ownerId === adviserId && unique.has(item.leadId));
      const adviserReassignments = reassignments.filter((item) => item.requestedBy === adviserId && unique.has(item.leadId));
      const rate = (value: number): number | null => primary.length === 0 ? null : Number((value / primary.length).toFixed(4));
      return {
        adviserId, primaryLeadCount: primary.length, secondaryLeadCount: secondary.length,
        statusVolumes: { contacted, qualified, enrolled, closedLost },
        rates: { contact: rate(contacted), qualification: rate(qualified), enrollment: rate(enrolled), loss: rate(closedLost) },
        medianMinutes: {
          firstHandling: this.median(primary.map((lead) => this.firstHandlingDelay(lead)).filter((value): value is number => value !== undefined)),
          contactToQualification: this.median(primary.map((lead) => this.stageDelay(lead, "CONTACTED", "QUALIFIED")).filter((value): value is number => value !== undefined)),
          qualificationToEnrollment: this.median(primary.map((lead) => this.stageDelay(lead, "QUALIFIED", "ENROLLED")).filter((value): value is number => value !== undefined)),
        },
        followUps: {
          planned: adviserFollowUps.filter((item) => item.state === "SCHEDULED" && item.dueAt > now.toISOString()).length,
          completed: adviserFollowUps.filter((item) => item.state === "COMPLETED").length,
          overdue: adviserFollowUps.filter((item) => (item.state === "SCHEDULED" || item.state === "DUE") && item.dueAt <= now.toISOString()).length,
          cancelled: adviserFollowUps.filter((item) => item.state === "CANCELLED").length,
        },
        inactiveLeadCount: primary.filter((lead) => !lead.lastActivityAt || lead.lastActivityAt < inactiveBefore).length,
        activeLoad: primary.filter((lead) => lead.status !== "ENROLLED" && lead.status !== "CLOSED_LOST").length,
        reassignments: {
          requested: adviserReassignments.length,
          approved: adviserReassignments.filter((item) => item.status === "APPROVED").length,
          rejected: adviserReassignments.filter((item) => item.status === "REJECTED").length,
        },
        drillDown: {
          assigned: `/leads?assignedToId=${encodeURIComponent(adviserId)}`,
          overdue: `/leads?assignedToId=${encodeURIComponent(adviserId)}&view=FOLLOW_UP`,
          inactive: `/leads?assignedToId=${encodeURIComponent(adviserId)}&view=NO_ACTIVITY`,
        },
      } satisfies AdviserPerformance;
    });
    const report: CommercialPerformanceReport = {
      definitionVersion: COMMERCIAL_PERFORMANCE_VERSION, timezone: COMMERCIAL_PERFORMANCE_TIMEZONE,
      generatedAt: now.toISOString(), cohort: { ...(from ? { from } : {}), ...(to ? { to } : {}), inactivityHours, uniqueLeadCount: cohort.length }, advisers,
      definitions: [
        { key: "contactRate", numerator: "distinct primary leads that reached CONTACTED or beyond", denominator: "distinct primary leads", inclusions: ["CONTACTED", "QUALIFIED", "ENROLLED", "CLOSED_LOST after contact"], exclusions: ["secondary contributions", "unassigned leads"] },
        { key: "qualificationRate", numerator: "distinct primary leads that reached QUALIFIED or ENROLLED", denominator: "distinct primary leads", inclusions: ["QUALIFIED", "ENROLLED"], exclusions: ["secondary contributions"] },
        { key: "enrollmentRate", numerator: "distinct primary leads that reached ENROLLED", denominator: "distinct primary leads", inclusions: ["ENROLLED"], exclusions: ["secondary contributions"] },
        { key: "lossRate", numerator: "distinct primary leads currently CLOSED_LOST", denominator: "distinct primary leads", inclusions: ["CLOSED_LOST"], exclusions: ["secondary contributions"] },
        { key: "activeLoad", numerator: "distinct primary leads in a non-terminal current state", denominator: "not applicable", inclusions: ["PROSPECT", "CONTACTED", "QUALIFIED"], exclusions: ["ENROLLED", "CLOSED_LOST"] },
      ],
    };
    this.audit.record({ eventType: "COMMERCIAL_PERFORMANCE_VIEWED", actorId: principal.userId, actorRoles: principal.roles,
      sessionId: principal.sessionId, correlationId, after: { definitionVersion: COMMERCIAL_PERFORMANCE_VERSION,
        adviserCount: advisers.length, uniqueLeadCount: cohort.length,
        activeFilterNames: Object.entries(query).filter(([, value]) => Boolean(value)).map(([key]) => key).sort((left, right) => left.localeCompare(right, "en")) },
      result: "SUCCESS", idempotencyKey: `commercial-performance:${randomUUID()}` });
    return report;
  }

  private reached(lead: LeadReportingRow, stage: "CONTACTED" | "QUALIFIED" | "ENROLLED"): boolean {
    const currentOrder = { PROSPECT: 0, CONTACTED: 1, QUALIFIED: 2, ENROLLED: 3, CLOSED_LOST: 0 } as const;
    const required = { CONTACTED: 1, QUALIFIED: 2, ENROLLED: 3 } as const;
    return currentOrder[lead.status] >= required[stage]
      || lead.activities.some((activity) => activity.type === "STATUS_CHANGED" && activity.result.split("->")[1] === stage)
      || (stage === "CONTACTED" && lead.status === "CLOSED_LOST");
  }

  private firstHandlingDelay(lead: LeadReportingRow): number | undefined {
    const first = lead.activities.filter((activity) => handlingTypes.has(activity.type))
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.authorId.localeCompare(right.authorId))[0];
    return first ? Math.max(0, (new Date(first.occurredAt).valueOf() - new Date(lead.createdAt).valueOf()) / 60_000) : undefined;
  }

  private stageDelay(lead: LeadReportingRow, from: string, to: string): number | undefined {
    const stages = lead.activities.filter((activity) => activity.type === "STATUS_CHANGED")
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    const fromAt = stages.find((activity) => activity.result.split("->")[1] === from)?.occurredAt;
    const toAt = stages.find((activity) => activity.result.split("->")[1] === to)?.occurredAt;
    return fromAt && toAt && toAt >= fromAt ? (new Date(toAt).valueOf() - new Date(fromAt).valueOf()) / 60_000 : undefined;
  }

  private median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    const value = sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
    return Number(value.toFixed(2));
  }

  private boundary(value: string | undefined, code: string): string | undefined {
    if (!value) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.valueOf())) throw new BadRequestException({ code });
    return parsed.toISOString();
  }
}
