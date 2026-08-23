import { Injectable } from "@nestjs/common";
import type { Principal } from "../auth/auth.types.js";
import { LeadService, type LeadAssignmentSnapshot } from "../leads/lead.service.js";
import { AssignmentService, type AssignmentRule } from "./assignment.service.js";
import { LeadAssignmentService } from "./lead-assignment.service.js";
import { ReassignmentService } from "./reassignment.service.js";

export interface AssignmentDashboard {
  leads: LeadAssignmentSnapshot;
  configuration: { activeRules: number; strategies: string[]; versions: number[]; updatedAt?: string };
  activity: { automaticDecisions: number; completedBatches: number; assignedByBatch: number; refusedByBatch: number; pendingReassignments: number };
  alerts: Array<{ code: string; severity: "INFO" | "WARNING" }>;
}

@Injectable()
export class AssignmentDashboardService {
  constructor(
    private readonly leads: LeadService,
    private readonly engine: AssignmentService,
    private readonly batches: LeadAssignmentService,
    private readonly reassignments: ReassignmentService,
  ) {}

  read(principal: Principal): AssignmentDashboard {
    const leads = this.leads.assignmentSnapshot(principal);
    const rules = this.engine.listRules();
    const decisions = this.engine.decisionHistory(principal);
    const batches = this.batches.completedHistory(principal);
    const pending = this.reassignments.pendingForManager(principal);
    const active = rules.filter((rule) => rule.enabled);
    const alerts: AssignmentDashboard["alerts"] = [];
    if (!active.length) alerts.push({ code: "assignment_configuration_inactive", severity: "WARNING" });
    if (leads.unassigned) alerts.push({ code: "unassigned_leads_present", severity: "WARNING" });
    if (pending.length) alerts.push({ code: "reassignments_pending", severity: "INFO" });
    return {
      leads,
      configuration: { activeRules: active.length, strategies: this.unique(active.map((rule) => rule.strategy)),
        versions: this.uniqueNumbers(rules.map((rule) => rule.version)), ...this.latestUpdate(rules) },
      activity: { automaticDecisions: decisions.length, completedBatches: batches.length,
        assignedByBatch: batches.reduce((sum, batch) => sum + batch.assigned.length, 0),
        refusedByBatch: batches.reduce((sum, batch) => sum + batch.refused.length, 0), pendingReassignments: pending.length },
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
