import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";

export type AssignmentStrategy = "ROUND_ROBIN" | "CONTROLLED_RANDOM";
export type AssignmentScope = "GLOBAL" | "SOURCE" | "CAMPAIGN";

export interface AssignmentCandidate {
  userId: string;
  active: boolean;
  suspended?: boolean;
  excluded?: boolean;
  capacity: number;
  activeLeadCount: number;
}

export interface AssignmentRuleInput {
  id?: string;
  scope: AssignmentScope;
  matchValue?: string;
  strategy: AssignmentStrategy;
  enabled: boolean;
  candidates: AssignmentCandidate[];
}

export interface AssignmentRule extends Omit<AssignmentRuleInput, "id"> {
  id: string;
  version: number;
  cursor: number;
  updatedAt: string;
  updatedBy: string;
}

export interface AssignmentDecision {
  id: string;
  eventKey: string;
  leadId: string;
  ruleId: string;
  strategy: AssignmentStrategy;
  selectedUserId: string;
  candidateIds: string[];
  candidateFingerprint: string;
  algorithmVersion: "assignment-v1";
  createdAt: string;
}

export interface AssignmentContext { leadId: string; source: string; campaign: string; eventKey: string }
export interface AssignmentSimulation { ruleId: string; strategy: AssignmentStrategy; selectedUserId: string; candidateIds: string[]; mutated: false }

const IDENTIFIER = /^[a-zA-Z0-9_-]{2,64}$/;

@Injectable()
export class AssignmentService {
  private readonly rules = new Map<string, Readonly<AssignmentRule>>();
  private readonly decisions = new Map<string, Readonly<AssignmentDecision>>();
  private history: Readonly<AssignmentRule>[] = [];

  constructor(private readonly audit: AuditService) {}

  configure(inputs: AssignmentRuleInput[], principal: Principal, correlationId: string): AssignmentRule[] {
    this.assertManager(principal);
    if (!inputs.length) throw new BadRequestException({ code: "assignment_rules_empty" });
    const normalized = inputs.map((input) => this.normalizeRule(input, principal.userId));
    const uniqueScopes = new Set(normalized.map((rule) => `${rule.scope}:${rule.matchValue ?? ""}`));
    if (uniqueScopes.size !== normalized.length) throw new ConflictException({ code: "assignment_rule_duplicate_scope" });
    if (normalized.filter((rule) => rule.scope === "GLOBAL" && rule.enabled).length !== 1) throw new BadRequestException({ code: "assignment_global_rule_required" });
    this.rules.clear();
    for (const rule of normalized) this.rules.set(rule.id, Object.freeze(rule));
    this.history = [...this.history, ...normalized.map((rule) => Object.freeze({ ...rule, candidates: rule.candidates.map((candidate) => ({ ...candidate })) }))];
    this.audit.record({ eventType: "ASSIGNMENT_CONFIGURATION_CHANGED", actorId: principal.userId, actorRoles: principal.roles,
      sessionId: principal.sessionId, correlationId, after: { ruleIds: normalized.map((rule) => rule.id), ruleCount: normalized.length },
      result: "SUCCESS", idempotencyKey: `assignment-config:${correlationId}` });
    return this.listRules();
  }

  listRules(): AssignmentRule[] {
    return [...this.rules.values()].sort((left, right) => left.id.localeCompare(right.id)).map((rule) => this.copyRule(rule));
  }

  configurationHistory(principal: Principal): AssignmentRule[] {
    this.assertManager(principal);
    return this.history.map((rule) => this.copyRule(rule));
  }

  simulate(context: AssignmentContext, principal: Principal): AssignmentSimulation {
    this.assertManager(principal);
    const selection = this.select(context, false);
    return { ...selection, mutated: false };
  }

  assign(context: AssignmentContext, principal: Principal, correlationId: string): AssignmentDecision {
    if (!principal.roles.some((role) => role === "ADMISSIONS" || role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "assignment_role_forbidden" });
    const existing = this.decisions.get(context.eventKey);
    if (existing) return this.copyDecision(existing);
    const selection = this.select(context, true);
    const decision: Readonly<AssignmentDecision> = Object.freeze({ id: randomUUID(), eventKey: context.eventKey, leadId: context.leadId,
      ...selection, algorithmVersion: "assignment-v1", createdAt: new Date().toISOString() });
    this.decisions.set(context.eventKey, decision);
    this.audit.record({ eventType: "LEAD_AUTO_ASSIGNED", actorId: principal.userId, actorRoles: principal.roles,
      sessionId: principal.sessionId, correlationId, after: { leadId: context.leadId, ruleId: decision.ruleId,
        selectedUserId: decision.selectedUserId, strategy: decision.strategy, algorithmVersion: decision.algorithmVersion },
      result: "SUCCESS", idempotencyKey: `assignment-decision:${context.eventKey}` });
    return this.copyDecision(decision);
  }

  decisionHistory(principal: Principal): AssignmentDecision[] {
    this.assertManager(principal);
    return [...this.decisions.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)).map((item) => this.copyDecision(item));
  }

  assertEligibleTarget(userId: string): void {
    const candidate = [...this.rules.values()].flatMap((rule) => rule.enabled ? rule.candidates : [])
      .find((item) => item.userId === userId && item.active && !item.suspended && !item.excluded && item.activeLeadCount < item.capacity);
    if (!candidate) throw new ConflictException({ code: "assignment_target_ineligible" });
  }

  private select(context: AssignmentContext, mutateCursor: boolean): Omit<AssignmentDecision, "id" | "eventKey" | "leadId" | "algorithmVersion" | "createdAt"> {
    if (!context.leadId || !context.eventKey || !context.source?.trim() || !context.campaign?.trim()) throw new BadRequestException({ code: "assignment_context_invalid" });
    const specific = [...this.rules.values()].filter((rule) => rule.enabled && ((rule.scope === "SOURCE" && rule.matchValue === context.source.trim()) || (rule.scope === "CAMPAIGN" && rule.matchValue === context.campaign.trim())));
    if (specific.length > 1) throw new ConflictException({ code: "assignment_rule_ambiguous" });
    const rule = specific[0] ?? [...this.rules.values()].find((candidate) => candidate.enabled && candidate.scope === "GLOBAL");
    if (!rule) throw new NotFoundException({ code: "assignment_rule_not_found" });
    const eligible = rule.candidates.filter((candidate) => candidate.active && !candidate.suspended && !candidate.excluded && candidate.activeLeadCount < candidate.capacity)
      .sort((left, right) => left.userId.localeCompare(right.userId));
    if (!eligible.length) throw new ConflictException({ code: "assignment_candidate_unavailable" });
    let selected: AssignmentCandidate;
    if (rule.strategy === "ROUND_ROBIN") {
      selected = eligible[rule.cursor % eligible.length]!;
      if (mutateCursor) this.rules.set(rule.id, Object.freeze({ ...rule, cursor: rule.cursor + 1 }));
    } else {
      const digest = createHash("sha256").update(`assignment-v1:${rule.id}:${context.eventKey}`).digest();
      selected = eligible[digest.readUInt32BE(0) % eligible.length]!;
    }
    const candidateIds = eligible.map((candidate) => candidate.userId);
    return { ruleId: rule.id, strategy: rule.strategy, selectedUserId: selected.userId, candidateIds,
      candidateFingerprint: createHash("sha256").update(candidateIds.join(":"), "utf8").digest("hex") };
  }

  private normalizeRule(input: AssignmentRuleInput, actorId: string): AssignmentRule {
    if (!["GLOBAL", "SOURCE", "CAMPAIGN"].includes(input.scope) || !["ROUND_ROBIN", "CONTROLLED_RANDOM"].includes(input.strategy)) throw new BadRequestException({ code: "assignment_rule_invalid" });
    const matchValue = input.matchValue?.trim();
    if ((input.scope === "GLOBAL" && matchValue) || (input.scope !== "GLOBAL" && !matchValue)) throw new BadRequestException({ code: "assignment_rule_match_invalid" });
    if (!input.candidates.length || input.candidates.some((candidate) => !IDENTIFIER.test(candidate.userId) || !Number.isInteger(candidate.capacity) || candidate.capacity < 1 || !Number.isInteger(candidate.activeLeadCount) || candidate.activeLeadCount < 0)) throw new BadRequestException({ code: "assignment_candidate_invalid" });
    if (new Set(input.candidates.map((candidate) => candidate.userId)).size !== input.candidates.length) throw new ConflictException({ code: "assignment_candidate_duplicate" });
    return { id: input.id && IDENTIFIER.test(input.id) ? input.id : randomUUID(), scope: input.scope,
      ...(matchValue ? { matchValue } : {}), strategy: input.strategy, enabled: input.enabled,
      candidates: input.candidates.map((candidate) => ({ ...candidate })), version: 1, cursor: 0,
      updatedAt: new Date().toISOString(), updatedBy: actorId };
  }

  private assertManager(principal: Principal): void {
    if (!principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "assignment_manager_required" });
  }

  private copyRule(rule: Readonly<AssignmentRule>): AssignmentRule { return { ...rule, candidates: rule.candidates.map((candidate) => ({ ...candidate })) }; }
  private copyDecision(decision: Readonly<AssignmentDecision>): AssignmentDecision { return { ...decision, candidateIds: [...decision.candidateIds] }; }
}
