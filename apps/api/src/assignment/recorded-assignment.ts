import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

export interface RecordedAssignmentDecision {
  id: string; eventKey: string; leadId: string; campusId: string; configurationVersion: number;
  strategy: "ROUND_ROBIN" | "CONTROLLED_RANDOM" | "UNASSIGNED";
  selectedUserId: string | null; ruleId: string | null; candidateIds: string[]; candidateFingerprint: string | null;
  createdAt: string; algorithmVersion: "assignment-v1";
}

/** Replay reads the immutable evidence, never today's rules or today's candidate pool. */
export function recordedAssignment(value: Prisma.JsonValue | null): RecordedAssignmentDecision {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConflictException({ code: "assignment_receipt_invalid" });
  const { id, eventKey, leadId, campusId, configurationVersion, strategy, selectedUserId, ruleId, candidateIds, candidateFingerprint, createdAt, algorithmVersion } = value;
  if (typeof id !== "string" || typeof eventKey !== "string" || typeof leadId !== "string" || typeof campusId !== "string" || typeof createdAt !== "string"
    || typeof configurationVersion !== "number" || !Number.isSafeInteger(configurationVersion) || configurationVersion < 0
    || !Array.isArray(candidateIds) || !candidateIds.every((item): item is string => typeof item === "string")
    || (strategy !== "ROUND_ROBIN" && strategy !== "CONTROLLED_RANDOM" && strategy !== "UNASSIGNED") || algorithmVersion !== "assignment-v1"
    || (selectedUserId !== null && typeof selectedUserId !== "string") || (ruleId !== null && typeof ruleId !== "string")
    || (candidateFingerprint !== null && typeof candidateFingerprint !== "string")) throw new ConflictException({ code: "assignment_receipt_invalid" });
  return { id, eventKey, leadId, campusId, configurationVersion, strategy, selectedUserId, ruleId, candidateIds,
    candidateFingerprint, createdAt, algorithmVersion };
}
