import { ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { AssignmentRule, AssignmentDecision } from "./assignment.service.js";

/** Shared algorithm; callers own authorization, cursor persistence and transaction boundaries. */
export function selectAssignmentCandidate(rule: Pick<AssignmentRule, "id" | "strategy" | "cursor" | "candidates">, eventKey: string, offset = 0):
  Pick<AssignmentDecision, "ruleId" | "strategy" | "selectedUserId" | "candidateIds" | "candidateFingerprint"> {
  const eligible = rule.candidates.filter((candidate) => candidate.active && !candidate.suspended && !candidate.excluded && candidate.activeLeadCount < candidate.capacity)
    .sort((left, right) => left.userId.localeCompare(right.userId));
  if (!eligible.length) throw new ConflictException({ code: "assignment_candidate_unavailable" });
  const index = rule.strategy === "ROUND_ROBIN" ? (rule.cursor + offset) % eligible.length
    : createHash("sha256").update(`assignment-v1:${rule.id}:${eventKey}`).digest().readUInt32BE(0) % eligible.length;
  const candidateIds = eligible.map((candidate) => candidate.userId);
  return { ruleId: rule.id, strategy: rule.strategy, selectedUserId: eligible[index]!.userId, candidateIds,
    candidateFingerprint: createHash("sha256").update(candidateIds.join(":"), "utf8").digest("hex") };
}
