import { ConflictException, Inject, Injectable, Optional } from "@nestjs/common";
import type { Principal } from "../auth/auth.types.js";
import { LeadService, type LeadAssignmentSnapshot } from "../leads/lead.service.js";
import { AssignmentService, type AssignmentRule } from "./assignment.service.js";
import { LeadAssignmentService } from "./lead-assignment.service.js";
import { ReassignmentService } from "./reassignment.service.js";
import { CampusAssignmentService } from "./campus-assignment.service.js";

export interface AssignmentDashboard {
  leads: LeadAssignmentSnapshot;
  configuration: { activeRules: number; strategies: string[]; versions: number[]; updatedAt?: string };
  activity: { automaticDecisions: number; completedBatches: number | null; assignedByBatch: number; refusedByBatch: number | null; pendingReassignments: number };
  evidence?: { source: "POSTGRESQL"; batchTotals: "UNAVAILABLE_NOT_PERSISTED"; historicalMemoryDecisions: "NOT_RECONSTRUCTED" };
  alerts: Array<{ code: string; severity: "INFO" | "WARNING" }>;
}

@Injectable()
export class AssignmentDashboardService {
  constructor(
    @Inject(LeadService) private readonly leads: LeadService,
    @Inject(AssignmentService) private readonly engine: AssignmentService,
    @Inject(LeadAssignmentService) private readonly batches: LeadAssignmentService,
    @Inject(ReassignmentService) private readonly reassignments: ReassignmentService,
    @Optional() @Inject(CampusAssignmentService) private readonly campusAssignments?: CampusAssignmentService,
  ) {}

  async readForApi(principal: Principal): Promise<AssignmentDashboard> {
    if (!this.leads.persistenceEnabled()) return this.read(principal);
    if (!this.campusAssignments) throw new ConflictException({ code: "persistent_assignment_unavailable" });
    const snapshot = await this.campusAssignments.reporting(principal);
    return { ...this.summarize(principal, snapshot.rules, { automaticDecisions: snapshot.automaticDecisions, assignedByBatch: snapshot.assignedByBatch,
      completedBatches: null, refusedByBatch: null, pendingReassignments: snapshot.pendingReassignments }, snapshot.leads),
      evidence: { source: "POSTGRESQL", batchTotals: "UNAVAILABLE_NOT_PERSISTED", historicalMemoryDecisions: "NOT_RECONSTRUCTED" } };
  }

  read(principal: Principal): AssignmentDashboard {
    const rules = this.engine.listRules();
    const decisions = this.engine.decisionHistory(principal);
    const batches = this.batches.completedHistory(principal);
    const pending = this.reassignments.pendingForManager(principal);
    return this.summarize(principal, rules, { automaticDecisions: decisions.length, completedBatches: batches.length,
      assignedByBatch: batches.reduce((sum, batch) => sum + batch.assigned.length, 0),
      refusedByBatch: batches.reduce((sum, batch) => sum + batch.refused.length, 0), pendingReassignments: pending.length });
  }

  private summarize(principal: Principal, rules: AssignmentRule[], activity: AssignmentDashboard["activity"], leads: LeadAssignmentSnapshot = this.leads.assignmentSnapshot(principal)): AssignmentDashboard {
    const active = rules.filter((rule) => rule.enabled);
    const alerts: AssignmentDashboard["alerts"] = [];
    if (!active.length) alerts.push({ code: "assignment_configuration_inactive", severity: "WARNING" });
    if (leads.unassigned) alerts.push({ code: "unassigned_leads_present", severity: "WARNING" });
    if (activity.pendingReassignments) alerts.push({ code: "reassignments_pending", severity: "INFO" });
    return {
      leads,
      configuration: { activeRules: active.length, strategies: this.unique(active.map((rule) => rule.strategy)),
        versions: this.uniqueNumbers(rules.map((rule) => rule.version)), ...this.latestUpdate(rules) },
      activity,
      alerts,
    };
  }

  private latestUpdate(rules: AssignmentRule[]): { updatedAt?: string } {
    const updatedAt = rules.map((rule) => rule.updatedAt).sort((left, right) => left.localeCompare(right)).at(-1);
    return updatedAt ? { updatedAt } : {};
  }
  private unique(values: string[]): string[] { return [...new Set(values)].sort((left, right) => left.localeCompare(right)); }
  private uniqueNumbers(values: number[]): number[] { return [...new Set(values)].sort((left, right) => left - right); }
}
