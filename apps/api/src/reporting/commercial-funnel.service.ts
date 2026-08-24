import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { LeadService, leadStatuses, type LeadReportingRow, type LeadStatus } from "../leads/lead.service.js";

export const FUNNEL_DEFINITION_VERSION = "commercial-funnel-v1";
export const FUNNEL_TIMEZONE = "Africa/Casablanca";
export interface CommercialFunnelQuery { from?: string; to?: string; campus?: string; campaign?: string; program?: string; source?: string }
export interface CommercialFunnel {
  definitionVersion: string; timezone: string; generatedAt: string;
  cohort: { from?: string; to?: string; totalUniqueLeads: number };
  currentState: Record<LeadStatus, number>;
  attainment: { contactedOrBeyond: number; qualifiedOrBeyond: number; enrolled: number };
  rates: { contactedOrBeyond: number | null; qualifiedOrBeyond: number | null; enrolled: number | null };
  breakdowns: Record<"campus" | "campaign" | "program" | "source", Array<{ value: string; count: number }>>;
  definitions: Array<{ key: string; formula: string; denominator: string; exclusions: string[] }>;
}

@Injectable()
export class CommercialFunnelService {
  constructor(private readonly leads: LeadService, private readonly audit: AuditService) {}

  read(query: CommercialFunnelQuery, principal: Principal, correlationId: string): CommercialFunnel {
    const from = this.boundary(query.from, "funnel_from_invalid");
    const to = this.boundary(query.to, "funnel_to_invalid");
    if (from && to && from >= to) throw new BadRequestException({ code: "funnel_period_invalid" });
    const exact = (value: string, expected?: string): boolean => !expected || value.localeCompare(expected.trim(), "fr", { sensitivity: "accent" }) === 0;
    const unique = new Map(this.leads.reportingSnapshot(principal)
      .filter((lead) => (!from || lead.createdAt >= from) && (!to || lead.createdAt < to)
        && exact(lead.campus, query.campus) && exact(lead.campaign, query.campaign)
        && exact(lead.program, query.program) && exact(lead.source, query.source))
      .map((lead) => [lead.id, lead]));
    const rows = [...unique.values()];
    const currentState = Object.fromEntries(leadStatuses.map((status) => [status, rows.filter((lead) => lead.status === status).length])) as Record<LeadStatus, number>;
    const total = rows.length;
    const attainment = {
      contactedOrBeyond: currentState.CONTACTED + currentState.QUALIFIED + currentState.ENROLLED,
      qualifiedOrBeyond: currentState.QUALIFIED + currentState.ENROLLED,
      enrolled: currentState.ENROLLED,
    };
    const rate = (value: number): number | null => total === 0 ? null : Number((value / total).toFixed(4));
    const result: CommercialFunnel = {
      definitionVersion: FUNNEL_DEFINITION_VERSION, timezone: FUNNEL_TIMEZONE, generatedAt: new Date().toISOString(),
      cohort: { ...(from ? { from } : {}), ...(to ? { to } : {}), totalUniqueLeads: total }, currentState, attainment,
      rates: { contactedOrBeyond: rate(attainment.contactedOrBeyond), qualifiedOrBeyond: rate(attainment.qualifiedOrBeyond), enrolled: rate(attainment.enrolled) },
      breakdowns: { campus: this.breakdown(rows, "campus"), campaign: this.breakdown(rows, "campaign"), program: this.breakdown(rows, "program"), source: this.breakdown(rows, "source") },
      definitions: [
        { key: "currentState", formula: "count(distinct lead.id) grouped by current status", denominator: "selected cohort", exclusions: ["historical statuses", "deleted records"] },
        { key: "contactedOrBeyond", formula: "CONTACTED + QUALIFIED + ENROLLED", denominator: "total unique leads in selected cohort", exclusions: ["CLOSED_LOST", "PROSPECT"] },
        { key: "qualifiedOrBeyond", formula: "QUALIFIED + ENROLLED", denominator: "total unique leads in selected cohort", exclusions: ["CLOSED_LOST", "CONTACTED", "PROSPECT"] },
        { key: "enrolled", formula: "ENROLLED", denominator: "total unique leads in selected cohort", exclusions: ["CLOSED_LOST"] },
      ],
    };
    this.audit.record({ eventType: "COMMERCIAL_FUNNEL_VIEWED", actorId: principal.userId, actorRoles: principal.roles,
      sessionId: principal.sessionId, correlationId, after: { definitionVersion: FUNNEL_DEFINITION_VERSION, totalUniqueLeads: total,
        activeFilterNames: Object.entries(query).filter(([, value]) => Boolean(value)).map(([key]) => key).sort() }, result: "SUCCESS",
      idempotencyKey: `commercial-funnel:${randomUUID()}` });
    return result;
  }

  private boundary(value: string | undefined, code: string): string | undefined {
    if (!value) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.valueOf())) throw new BadRequestException({ code });
    return parsed.toISOString();
  }
  private breakdown(rows: LeadReportingRow[], field: "campus" | "campaign" | "program" | "source"): Array<{ value: string; count: number }> {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row[field], (counts.get(row[field]) ?? 0) + 1);
    return [...counts].sort(([left], [right]) => left.localeCompare(right, "fr")).map(([value, count]) => ({ value, count }));
  }
}
