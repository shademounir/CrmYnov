import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { LeadService } from "../leads/lead.service.js";
import { matchesInteractiveFilters, type InteractiveReportingQuery } from "./reporting-filter.js";
import { hasPilotageReportingScope } from "./reporting-authority.js";
import { acquisitionPartition, isBaseline, observedEnrollment, type AcquisitionPartition } from "./acquisition-cohort.js";

export const SHARED_CONTRIBUTION_VERSION = "shared-contribution-v1";
export type SharedContributionQuery = InteractiveReportingQuery;
export interface ContributorRow {
  contributorId: string; primaryLeadCount: number; collaborativeLeadCount: number; primaryActionCount: number; secondaryActionCount: number;
  primaryEnrollmentCount: number; secondaryEnrollmentCount: 0; actionTypes: Array<{ type: string; primary: number; secondary: number }>;
  primaryBaselineEnrollmentStock: number;
  drillDown: { primary: string; collaborative: string };
}
export interface SharedContributionReport {
  definitionVersion: string; generatedAt: string; timezone: "Africa/Casablanca"; uniqueLeadCount: number; contributors: ContributorRow[];
  safeguards: { conversionsAttributedToPrimaryOnly: true; compensationCalculated: false; disciplinaryRanking: false };
  acquisition: AcquisitionPartition;
}

@Injectable()
export class SharedContributionService {
  constructor(private readonly leads: LeadService, private readonly audit: AuditService) {}
  read(query: SharedContributionQuery, principal: Principal, correlationId: string, now = new Date()): SharedContributionReport {
    const from = this.boundary(query.from, "contribution_from_invalid"); const to = this.boundary(query.to, "contribution_to_invalid");
    if (from && to && from >= to) {
      throw new BadRequestException({ code: "contribution_period_invalid" });
    }
    const normalized = { ...query, ...(from ? { from } : {}), ...(to ? { to } : {}), ...(query.view === "personal" ? { adviserId: principal.userId } : {}) };
    const rows = this.leads.reportingSnapshot(principal).filter((lead) => matchesInteractiveFilters(lead, normalized));
    const adviserOnly = query.view === "personal" || !hasPilotageReportingScope(principal) && principal.roles.includes("ADMISSIONS") && !principal.roles.some((role) => ["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(role));
    const ids = new Set(rows.flatMap((lead) => [lead.assignedToId, ...lead.collaboratorIds]).filter((value): value is string => Boolean(value)));
    if (adviserOnly) {
      ids.clear();
      ids.add(principal.userId);
    }
    const contributors = [...ids].sort((a, b) => a.localeCompare(b, "en")).map((contributorId) => {
      const primary = rows.filter((lead) => lead.assignedToId === contributorId);
      const collaborative = rows.filter((lead) => lead.assignedToId !== contributorId && lead.collaboratorIds.includes(contributorId));
      const actionsByContributor = (lead: typeof rows[number]): typeof lead.activities => lead.activities.filter((activity) => activity.authorId === contributorId
        && (!from || activity.occurredAt >= from) && (!to || activity.occurredAt < to)
        && (!isBaseline(lead) || activity.occurredAt >= lead.createdAt));
      const primaryActions = primary.flatMap(actionsByContributor);
      const secondaryActions = collaborative.flatMap(actionsByContributor);
      const actionTypes = [...new Set([...primaryActions, ...secondaryActions].map((activity) => activity.type))].sort((a, b) => a.localeCompare(b, "en"))
        .map((type) => ({ type, primary: primaryActions.filter((activity) => activity.type === type).length, secondary: secondaryActions.filter((activity) => activity.type === type).length }));
      return { contributorId, primaryLeadCount: primary.length, collaborativeLeadCount: collaborative.length, primaryActionCount: primaryActions.length,
        secondaryActionCount: secondaryActions.length, primaryEnrollmentCount: primary.filter((lead) => lead.status === "ENROLLED"
          && (!isBaseline(lead) || lead.activities.some((activity) => observedEnrollment(lead, activity, from, to)))).length,
        primaryBaselineEnrollmentStock: primary.filter((lead) => isBaseline(lead) && lead.status === "ENROLLED").length,
        secondaryEnrollmentCount: 0 as const, actionTypes, drillDown: { primary: `/leads?assignedToId=${encodeURIComponent(contributorId)}`, collaborative: `/leads?collaboratorId=${encodeURIComponent(contributorId)}` } };
    });
    const report: SharedContributionReport = { definitionVersion: SHARED_CONTRIBUTION_VERSION, generatedAt: now.toISOString(), timezone: "Africa/Casablanca",
      uniqueLeadCount: new Set(rows.map((row) => row.id)).size, contributors, acquisition: acquisitionPartition(rows),
      safeguards: { conversionsAttributedToPrimaryOnly: true, compensationCalculated: false, disciplinaryRanking: false } };
    this.audit.record({ eventType: "SHARED_CONTRIBUTION_VIEWED", actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId,
      correlationId, after: { definitionVersion: SHARED_CONTRIBUTION_VERSION, contributorCount: contributors.length, uniqueLeadCount: report.uniqueLeadCount,
        activeFilterNames: Object.entries(query).filter(([, value]) => Boolean(value)).map(([key]) => key).sort((a, b) => a.localeCompare(b, "en")) }, result: "SUCCESS", idempotencyKey: `shared-contribution:${randomUUID()}` });
    return report;
  }
  private boundary(value: string | undefined, code: string): string | undefined {
    if (!value) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.valueOf())) {
      throw new BadRequestException({ code });
    }
    return parsed.toISOString();
  }
}
