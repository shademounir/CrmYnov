import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { IngestionService, type IngestionReportingOccurrence } from "../ingestion/ingestion.service.js";
import { LeadService, type LeadReportingRow } from "../leads/lead.service.js";

export const SOURCE_EFFECTIVENESS_VERSION = "source-effectiveness-v1";
export const SOURCE_EFFECTIVENESS_TIMEZONE = "Africa/Casablanca";
type Dimension = "source" | "channel" | "campaign" | "program" | "campus" | "provenanceMode";
export interface SourceEffectivenessQuery { from?: string; to?: string; source?: string; campaign?: string; program?: string; campus?: string }
export interface EffectivenessGroup {
  value: string; evidence: "ingestion-occurrences" | "lead-cohort"; volumeReceived: number; uniqueLeadCount: number;
  rates: { duplicate: number | null; incomplete: number | null; contact: number | null; qualification: number | null; enrollment: number | null; closedLost: number | null };
  medianProcessingMinutes: number | null; unassigned: number; toVerify: number; drillDown: string;
}
export interface SourceEffectivenessReport {
  definitionVersion: string; timezone: string; generatedAt: string; cohort: { from?: string; to?: string; uniqueLeadCount: number };
  breakdowns: Record<Dimension, EffectivenessGroup[]>;
  definitions: Array<{ key: string; numerator: string; denominator: string; unavailableWhen: string }>;
  financialMetrics: { calculated: false; reason: string };
}

const dimensions: readonly Dimension[] = ["source", "channel", "campaign", "program", "campus", "provenanceMode"];
const handlingTypes = new Set(["CRM_CALL", "EXTERNAL_CALL", "PHONE_CALL", "PHYSICAL_VISIT", "WHATSAPP", "MANUAL_EMAIL", "MEETING"]);

@Injectable()
export class SourceEffectivenessService {
  constructor(private readonly leads: LeadService, private readonly ingestion: IngestionService, private readonly audit: AuditService) {}

  read(query: SourceEffectivenessQuery, principal: Principal, correlationId: string, now = new Date()): SourceEffectivenessReport {
    const from = this.boundary(query.from, "source_report_from_invalid"); const to = this.boundary(query.to, "source_report_to_invalid");
    if (from && to && from >= to) throw new BadRequestException({ code: "source_report_period_invalid" });
    const exact = (value: string, expected?: string): boolean => !expected || value.localeCompare(expected.trim(), "fr", { sensitivity: "accent" }) === 0;
    const leads = [...new Map(this.leads.reportingSnapshot(principal).filter((lead) => (!from || lead.createdAt >= from) && (!to || lead.createdAt < to)
      && exact(lead.source, query.source) && exact(lead.campaign, query.campaign) && exact(lead.program, query.program) && exact(lead.campus, query.campus))
      .map((lead) => [lead.id, lead])).values()];
    const leadIds = new Set(leads.map((lead) => lead.id));
    const occurrences = this.ingestion.reportingSnapshot(principal).filter((item) => (!from || item.receivedAt >= from) && (!to || item.receivedAt < to)
      && exact(item.source, query.source) && exact(item.campaign ?? "UNSPECIFIED", query.campaign)
      && exact(item.program ?? "UNSPECIFIED", query.program) && exact(item.campus ?? "UNSPECIFIED", query.campus)
      && (!item.leadId || leadIds.has(item.leadId)));
    const breakdowns = Object.fromEntries(dimensions.map((dimension) => [dimension, this.groups(dimension, leads, occurrences)])) as Record<Dimension, EffectivenessGroup[]>;
    const report: SourceEffectivenessReport = {
      definitionVersion: SOURCE_EFFECTIVENESS_VERSION, timezone: SOURCE_EFFECTIVENESS_TIMEZONE, generatedAt: now.toISOString(),
      cohort: { ...(from ? { from } : {}), ...(to ? { to } : {}), uniqueLeadCount: leads.length }, breakdowns,
      definitions: [
        { key: "duplicateRate", numerator: "structured ingestion occurrences attached to an existing lead", denominator: "structured ingestion occurrences", unavailableWhen: "no structured ingestion occurrence exists" },
        { key: "incompleteRate", numerator: "structured ingestion occurrences rejected for a required field or mapping", denominator: "structured ingestion occurrences", unavailableWhen: "no structured ingestion occurrence exists" },
        { key: "contactRate", numerator: "distinct leads that reached CONTACTED or beyond", denominator: "distinct leads in the group", unavailableWhen: "the group contains no lead" },
        { key: "qualificationRate", numerator: "distinct leads that reached QUALIFIED or ENROLLED", denominator: "distinct leads in the group", unavailableWhen: "the group contains no lead" },
        { key: "enrollmentRate", numerator: "distinct leads currently ENROLLED", denominator: "distinct leads in the group", unavailableWhen: "the group contains no lead" },
        { key: "closedLostRate", numerator: "distinct leads currently CLOSED_LOST", denominator: "distinct leads in the group", unavailableWhen: "the group contains no lead" },
      ],
      financialMetrics: { calculated: false, reason: "validated financial inputs are not available" },
    };
    this.audit.record({ eventType: "SOURCE_EFFECTIVENESS_VIEWED", actorId: principal.userId, actorRoles: principal.roles,
      sessionId: principal.sessionId, correlationId, after: { definitionVersion: SOURCE_EFFECTIVENESS_VERSION, uniqueLeadCount: leads.length,
        occurrenceCount: occurrences.length, activeFilterNames: Object.entries(query).filter(([, value]) => Boolean(value)).map(([key]) => key).sort((a, b) => a.localeCompare(b, "en")) },
      result: "SUCCESS", idempotencyKey: `source-effectiveness:${randomUUID()}` });
    return report;
  }

  private groups(dimension: Dimension, leads: LeadReportingRow[], occurrences: IngestionReportingOccurrence[]): EffectivenessGroup[] {
    const values = new Set([...leads.map((lead) => this.leadDimension(lead, dimension)), ...occurrences.map((item) => this.occurrenceDimension(item, dimension))]);
    return [...values].sort((a, b) => a.localeCompare(b, "fr")).map((value) => {
      const groupLeads = leads.filter((lead) => this.leadDimension(lead, dimension) === value);
      const groupOccurrences = occurrences.filter((item) => this.occurrenceDimension(item, dimension) === value);
      const volumeReceived = groupOccurrences.length || groupLeads.length;
      const occurrenceRate = (count: number): number | null => groupOccurrences.length === 0 ? null : Number((count / groupOccurrences.length).toFixed(4));
      const leadRate = (count: number): number | null => groupLeads.length === 0 ? null : Number((count / groupLeads.length).toFixed(4));
      const processing = groupLeads.map((lead) => this.processingDelay(lead)).filter((item): item is number => item !== undefined);
      const params = new URLSearchParams({ [dimension === "provenanceMode" || dimension === "channel" ? "source" : dimension]: value });
      return { value, evidence: groupOccurrences.length ? "ingestion-occurrences" : "lead-cohort", volumeReceived, uniqueLeadCount: groupLeads.length,
        rates: { duplicate: occurrenceRate(groupOccurrences.filter((item) => item.outcome === "PROVENANCE_ATTACHED").length),
          incomplete: occurrenceRate(groupOccurrences.filter((item) => this.incomplete(item.reason)).length),
          contact: leadRate(groupLeads.filter((lead) => this.reached(lead, "CONTACTED")).length),
          qualification: leadRate(groupLeads.filter((lead) => this.reached(lead, "QUALIFIED")).length),
          enrollment: leadRate(groupLeads.filter((lead) => lead.status === "ENROLLED").length),
          closedLost: leadRate(groupLeads.filter((lead) => lead.status === "CLOSED_LOST").length) },
        medianProcessingMinutes: this.median(processing), unassigned: groupLeads.filter((lead) => !lead.assignedToId).length,
        toVerify: groupOccurrences.filter((item) => item.outcome === "MANUAL_REVIEW").length, drillDown: `/leads?${params.toString()}` };
    });
  }

  private leadDimension(lead: LeadReportingRow, dimension: Dimension): string {
    if (dimension === "channel") return this.channel(lead.source);
    if (dimension === "provenanceMode") return this.provenanceMode(lead.source, Boolean(lead.importBatchId));
    if (dimension === "program") return lead.program || "UNSPECIFIED";
    return lead[dimension] || "UNSPECIFIED";
  }
  private occurrenceDimension(item: IngestionReportingOccurrence, dimension: Dimension): string {
    if (dimension === "channel") return this.channel(item.source);
    if (dimension === "provenanceMode") return this.provenanceMode(item.source, item.profile !== "CUSTOM");
    if (dimension === "program") return item.program || "UNSPECIFIED";
    if (dimension === "source") return item.source;
    return item[dimension] || "UNSPECIFIED";
  }
  private channel(source: string): string { if (source === "PHONE_CALL") return "PHONE"; if (source === "PHYSICAL_VISIT" || source === "EVENT") return "IN_PERSON"; if (["WEB_FORM", "WEBSITE", "FORMINATOR_ZAPIER", "YNOV_COM"].includes(source)) return "DIGITAL"; if (source === "PARTNER" || source === "JOBINTECH") return "PARTNER"; return "OTHER"; }
  private provenanceMode(source: string, imported: boolean): string { if (source === "LEGACY_IMPORT") return "IMPORTED"; if (["WEB_FORM", "WEBSITE", "FORMINATOR_ZAPIER", "YNOV_COM"].includes(source)) return "AUTOMATIC"; return imported ? "IMPORTED" : "MANUAL"; }
  private incomplete(reason?: string): boolean { return ["required_mapping_missing", "identity_required", "stable_identity_missing"].includes(reason ?? ""); }
  private reached(lead: LeadReportingRow, stage: "CONTACTED" | "QUALIFIED"): boolean { const order = { PROSPECT: 0, CONTACTED: 1, QUALIFIED: 2, ENROLLED: 3, CLOSED_LOST: 0 } as const; const level = stage === "CONTACTED" ? 1 : 2; return order[lead.status] >= level || lead.activities.some((activity) => activity.type === "STATUS_CHANGED" && activity.result.split("->")[1] === stage) || (stage === "CONTACTED" && lead.status === "CLOSED_LOST"); }
  private processingDelay(lead: LeadReportingRow): number | undefined { const first = lead.activities.filter((activity) => handlingTypes.has(activity.type)).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))[0]; return first ? Math.max(0, (new Date(first.occurredAt).valueOf() - new Date(lead.createdAt).valueOf()) / 60_000) : undefined; }
  private median(values: number[]): number | null { if (!values.length) return null; const ordered = [...values].sort((a, b) => a - b); const middle = Math.floor(ordered.length / 2); return Number((ordered.length % 2 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2).toFixed(2)); }
  private boundary(value: string | undefined, code: string): string | undefined { if (!value) return undefined; const parsed = new Date(value); if (Number.isNaN(parsed.valueOf())) throw new BadRequestException({ code }); return parsed.toISOString(); }
}
