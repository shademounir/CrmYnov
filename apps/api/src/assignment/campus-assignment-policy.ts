import { BadRequestException, ConflictException } from "@nestjs/common";
import type { AssignmentRuleInput } from "./assignment.service.js";

/** PO CRMY-171: only peers at the selected priority can be ambiguous. */
export function applicableCampusRule<T extends Pick<AssignmentRuleInput, "scope" | "matchValue" | "enabled">>(rules: readonly T[], source: string, campaign: string): T | undefined {
  for (const scope of ["CAMPAIGN", "SOURCE", "GLOBAL"] as const) {
    const matches = rules.filter((rule) => rule.enabled && rule.scope === scope && (scope === "GLOBAL" || rule.matchValue === (scope === "CAMPAIGN" ? campaign : source)));
    if (matches.length > 1) throw new ConflictException({ code: "assignment_rule_ambiguous" });
    if (matches.length === 1) return matches[0];
  }
  return undefined;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException({ code: "assignment_configuration_invalid" });
  return Object.fromEntries(Object.entries(value));
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new BadRequestException({ code: "assignment_configuration_invalid" });
  return value.trim();
}
export function parseCampusRules(value: unknown): AssignmentRuleInput[] {
  if (!Array.isArray(value) || value.length > 100) throw new BadRequestException({ code: "assignment_configuration_invalid" });
  return value.map((raw): AssignmentRuleInput => {
    const rule = object(raw);
    if (rule.scope !== "GLOBAL" && rule.scope !== "SOURCE" && rule.scope !== "CAMPAIGN") throw new BadRequestException({ code: "assignment_rule_invalid" });
    if (rule.strategy !== "ROUND_ROBIN" && rule.strategy !== "CONTROLLED_RANDOM") throw new BadRequestException({ code: "assignment_rule_invalid" });
    if (typeof rule.enabled !== "boolean" || !Array.isArray(rule.candidates) || rule.candidates.length > 100) throw new BadRequestException({ code: "assignment_rule_invalid" });
    return { ...(rule.id !== undefined ? { id: text(rule.id) } : {}), scope: rule.scope, strategy: rule.strategy, enabled: rule.enabled,
      ...(rule.matchValue !== undefined ? { matchValue: text(rule.matchValue) } : {}), candidates: rule.candidates.map((rawCandidate) => {
        const candidate = object(rawCandidate);
        if (typeof candidate.active !== "boolean" || typeof candidate.capacity !== "number" || !Number.isSafeInteger(candidate.capacity) || candidate.capacity < 1
          || candidate.suspended !== undefined && typeof candidate.suspended !== "boolean" || candidate.excluded !== undefined && typeof candidate.excluded !== "boolean") {
          throw new BadRequestException({ code: "assignment_candidate_invalid" });
        }
        return { userId: text(candidate.userId), active: candidate.active, capacity: candidate.capacity, activeLeadCount: 0,
          suspended: candidate.suspended === true, excluded: candidate.excluded === true };
      }) };
  });
}
