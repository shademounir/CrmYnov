import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";

export const REVIEW_REASONS = ["IDENTITY_COLLISION", "NAME_AMBIGUOUS", "STATUS_UNKNOWN", "PROGRAM_UNKNOWN", "OWNER_UNKNOWN", "SOURCE_UNKNOWN", "LOW_CONFIDENCE_MAPPING"] as const;
export type ReviewReason = typeof REVIEW_REASONS[number];
export type ReviewDecision = "CREATE" | "ATTACH" | "IGNORE";
export interface ReviewItem { id: string; batchId: string; lineNumber: number; reasons: ReviewReason[]; candidateLeadIds: string[]; status: "PENDING" | "RESOLVED"; version: number; decision?: ReviewDecision; targetLeadId?: string; decidedBy?: string; decidedAt?: string }
export interface EnqueueReviewInput { batchId: string; lineNumber: number; reasons: ReviewReason[]; candidateLeadIds?: string[] }
export interface DecideReviewInput { decision: ReviewDecision; expectedVersion: number; idempotencyKey: string; targetLeadId?: string }
const ID = /^[a-z0-9][a-z0-9_-]{2,79}$/i; const UUID = /^[0-9a-f-]{36}$/i;

@Injectable()
export class ImportReviewService {
  private readonly items = new Map<string, ReviewItem>(); private readonly receipts = new Map<string, ReviewItem>();
  enqueue(input: EnqueueReviewInput, principal: Principal): ReviewItem {
    this.assertManager(principal);
    const candidates = input.candidateLeadIds ?? [];
    if (!ID.test(input.batchId) || !Number.isInteger(input.lineNumber) || input.lineNumber < 1 || input.reasons.length < 1
      || input.reasons.some((reason) => !REVIEW_REASONS.includes(reason)) || new Set(input.reasons).size !== input.reasons.length
      || candidates.some((id) => !UUID.test(id)) || new Set(candidates).size !== candidates.length)
      throw new BadRequestException({ code: "import_review_item_invalid" });
    const item: ReviewItem = { id: randomUUID(), batchId: input.batchId, lineNumber: input.lineNumber, reasons: [...input.reasons].sort(), candidateLeadIds: [...candidates].sort(), status: "PENDING", version: 1 };
    this.items.set(item.id, item); return structuredClone(item);
  }
  list(principal: Principal): ReviewItem[] { this.assertManager(principal); return [...this.items.values()].map((item) => structuredClone(item)).sort((a, b) => a.lineNumber - b.lineNumber); }
  decide(id: string, input: DecideReviewInput, principal: Principal): ReviewItem {
    this.assertManager(principal); const receipt = this.receipts.get(input.idempotencyKey); if (receipt) return structuredClone(receipt);
    const item = this.items.get(id); if (!item) throw new NotFoundException({ code: "import_review_not_found" });
    if (!ID.test(input.idempotencyKey) || !(["CREATE", "ATTACH", "IGNORE"] as const).includes(input.decision) || input.expectedVersion !== item.version)
      throw new ConflictException({ code: "import_review_decision_conflict" });
    if (input.decision === "ATTACH" && (!input.targetLeadId || !item.candidateLeadIds.includes(input.targetLeadId))) throw new ForbiddenException({ code: "import_review_target_forbidden" });
    if (input.decision !== "ATTACH" && input.targetLeadId) throw new BadRequestException({ code: "import_review_target_unexpected" });
    const resolved: ReviewItem = { ...item, status: "RESOLVED", version: item.version + 1, decision: input.decision,
      ...(input.targetLeadId ? { targetLeadId: input.targetLeadId } : {}), decidedBy: principal.userId, decidedAt: new Date().toISOString() };
    this.items.set(id, resolved); this.receipts.set(input.idempotencyKey, resolved); return structuredClone(resolved);
  }
  private assertManager(principal: Principal): void { if (!principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "import_review_forbidden" }); }
}
