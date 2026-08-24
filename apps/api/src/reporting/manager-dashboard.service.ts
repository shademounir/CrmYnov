import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { CommercialFunnelService, type CommercialFunnel } from "./commercial-funnel.service.js";
import { CommercialPerformanceService, type CommercialPerformanceReport } from "./commercial-performance.service.js";
import { OperationalRiskService, type OperationalRiskReport } from "./operational-risk.service.js";
import { SharedContributionService, type SharedContributionReport } from "./shared-contribution.service.js";
import { SourceEffectivenessService, type SourceEffectivenessReport } from "./source-effectiveness.service.js";

export const MANAGER_DASHBOARD_VERSION = "manager-dashboard-v1";
export interface ManagerDashboardQuery { from?: string; to?: string; campus?: string }
export interface ManagerDashboardReport {
  definitionVersion: string; generatedAt: string; timezone: "Africa/Casablanca";
  filters: ManagerDashboardQuery;
  panels: {
    funnel: CommercialFunnel; performance: CommercialPerformanceReport; sourceEffectiveness: SourceEffectivenessReport;
    operationalRisks: OperationalRiskReport; sharedContributions: SharedContributionReport;
  };
  navigation: Array<{ key: string; href: string; definitionVersion: string }>;
  safeguards: { singlePrimaryConversionAttribution: true; financialDecision: false; disciplinaryScore: false };
}

@Injectable()
export class ManagerDashboardService {
  constructor(
    private readonly funnel: CommercialFunnelService,
    private readonly performance: CommercialPerformanceService,
    private readonly sources: SourceEffectivenessService,
    private readonly risks: OperationalRiskService,
    private readonly contributions: SharedContributionService,
    private readonly audit: AuditService,
  ) {}

  read(query: ManagerDashboardQuery, principal: Principal, correlationId: string, now = new Date()): ManagerDashboardReport {
    const common = { ...(query.from ? { from: query.from } : {}), ...(query.to ? { to: query.to } : {}), ...(query.campus ? { campus: query.campus } : {}) };
    const panels = {
      funnel: this.funnel.read(common, principal, correlationId),
      performance: this.performance.read(common, principal, correlationId, now),
      sourceEffectiveness: this.sources.read(common, principal, correlationId, now),
      operationalRisks: this.risks.read(common, principal, correlationId, now),
      sharedContributions: this.contributions.read(common, principal, correlationId, now),
    };
    const navigation = [
      { key: "funnel", href: "/manager/reports/commercial-funnel", definitionVersion: panels.funnel.definitionVersion },
      { key: "performance", href: "/manager/reports/commercial-performance", definitionVersion: panels.performance.definitionVersion },
      { key: "sourceEffectiveness", href: "/manager/reports/source-effectiveness", definitionVersion: panels.sourceEffectiveness.definitionVersion },
      { key: "operationalRisks", href: "/manager/reports/operational-risks", definitionVersion: panels.operationalRisks.definitionVersion },
      { key: "sharedContributions", href: "/manager/reports/shared-contributions", definitionVersion: panels.sharedContributions.definitionVersion },
    ];
    const report: ManagerDashboardReport = { definitionVersion: MANAGER_DASHBOARD_VERSION, generatedAt: now.toISOString(), timezone: "Africa/Casablanca",
      filters: common, panels, navigation, safeguards: { singlePrimaryConversionAttribution: true, financialDecision: false, disciplinaryScore: false } };
    this.audit.record({ eventType: "MANAGER_DASHBOARD_VIEWED", actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId,
      correlationId, after: { definitionVersion: MANAGER_DASHBOARD_VERSION, panelCount: navigation.length,
        activeFilterNames: Object.keys(common).sort((a, b) => a.localeCompare(b, "en")) }, result: "SUCCESS", idempotencyKey: `manager-dashboard:${randomUUID()}` });
    return report;
  }
}
