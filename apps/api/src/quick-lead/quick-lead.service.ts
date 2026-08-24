import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import type { Principal } from "../auth/auth.types.js";
import { LeadAssignmentService, type BatchAssignmentStrategy } from "../assignment/lead-assignment.service.js";
import { IngestionService } from "../ingestion/ingestion.service.js";
import { LeadService, type LeadRecord } from "../leads/lead.service.js";

export type QuickLeadChannel = "PHONE_CALL" | "PHYSICAL_VISIT";
export interface QuickLeadInput {
  idempotencyKey: string; channel: QuickLeadChannel; firstName: string; lastName: string; email?: string; phone?: string;
  campus?: string; campaign?: string; educationLevel?: string; program?: string; nextActionAt?: string;
  assignment: { strategy: "UNASSIGNED" | BatchAssignmentStrategy; targetUserId?: string };
}
export interface QuickLeadResult {
  outcome: "CREATED" | "EXISTING"; lead: LeadRecord; activityType: QuickLeadChannel; provenanceBatchId: string;
  assignmentOutcome: "ASSIGNED" | "UNASSIGNED" | "REFUSED"; replayed: boolean;
}
const IDEMPOTENCY_KEY = /^[A-Za-z0-9:_-]{8,128}$/;
const TO_COMPLETE = "À compléter";

@Injectable()
export class QuickLeadService {
  private readonly receipts = new Map<string, Readonly<QuickLeadResult>>();
  constructor(private readonly leads: LeadService, private readonly ingestion: IngestionService, private readonly assignments: LeadAssignmentService) {}

  preview(email: string | undefined, phone: string | undefined, principal: Principal): { items: ReturnType<LeadService["findIdentityCandidates"]> } {
    this.assertRole(principal);
    if (!email?.trim() && !phone?.trim()) throw new BadRequestException({ code: "quick_lead_identity_required" });
    return { items: this.leads.findIdentityCandidates(email, phone) };
  }

  submit(input: QuickLeadInput, principal: Principal, correlationId: string): QuickLeadResult {
    this.assertRole(principal);
    this.validate(input);
    const previous = this.receipts.get(input.idempotencyKey);
    if (previous) return { ...previous, lead: { ...previous.lead }, replayed: true };
    const matches = this.leads.findIdentityMatches(input.email, input.phone);
    if (matches.emailLeadId && matches.phoneLeadId && matches.emailLeadId !== matches.phoneLeadId) throw new ConflictException({ code: "quick_lead_identity_collision" });
    const existingLeadId = matches.emailLeadId ?? matches.phoneLeadId;
    const outcome = existingLeadId ? "EXISTING" as const : "CREATED" as const;
    const initialLead = existingLeadId ? this.leads.findLocalLead(existingLeadId) : this.create(input, principal, correlationId);
    if (!initialLead) throw new ConflictException({ code: "quick_lead_match_unavailable" });
    const provenance = this.ingestion.attachOperationalProvenance(initialLead.id, { source: input.channel,
      idempotencyKey: input.idempotencyKey, ...(input.campaign?.trim() ? { campaign: input.campaign } : {}) }, principal, `${correlationId}:provenance`);
    this.leads.addActivity(initialLead.id, { type: input.channel, result: "COMPLETED",
      ...(input.nextActionAt ? { nextActionAt: input.nextActionAt } : {}) }, principal, `${correlationId}:activity`);
    const assignmentOutcome = outcome === "CREATED" ? this.assign(initialLead, input, principal, correlationId) : "UNASSIGNED";
    const lead = this.leads.findLocalLead(initialLead.id)!;
    const result: Readonly<QuickLeadResult> = Object.freeze({ outcome, lead: Object.freeze({ ...lead }), activityType: input.channel,
      provenanceBatchId: provenance.batchId, assignmentOutcome, replayed: false });
    this.receipts.set(input.idempotencyKey, result);
    return { ...result, lead: { ...result.lead } };
  }

  private create(input: QuickLeadInput, principal: Principal, correlationId: string): LeadRecord {
    return this.leads.createLead({ firstName: input.firstName, lastName: input.lastName,
      ...(input.email?.trim() ? { email: input.email } : {}), ...(input.phone?.trim() ? { phone: input.phone } : {}),
      campus: input.campus?.trim() || TO_COMPLETE, campaign: input.campaign?.trim() || `MANUAL_${input.channel}`,
      educationLevel: input.educationLevel?.trim() || TO_COMPLETE, program: input.program?.trim() || TO_COMPLETE,
      source: input.channel, ...(input.nextActionAt ? { nextActionAt: input.nextActionAt } : {}) }, principal, `${correlationId}:create`).lead;
  }

  private assign(lead: LeadRecord, input: QuickLeadInput, principal: Principal, correlationId: string): QuickLeadResult["assignmentOutcome"] {
    if (input.assignment.strategy === "UNASSIGNED") return "UNASSIGNED";
    if (!principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "quick_lead_assignment_role_forbidden" });
    const result = this.assignments.assignBatch({ idempotencyKey: `${input.idempotencyKey}:assignment`, confirmed: true,
      strategy: input.assignment.strategy, ...(input.assignment.targetUserId ? { targetUserId: input.assignment.targetUserId } : {}),
      items: [{ leadId: lead.id, source: input.channel, campaign: lead.campaign }] }, principal, `${correlationId}:assignment`);
    return result.assigned.length === 1 ? "ASSIGNED" : "REFUSED";
  }

  private validate(input: QuickLeadInput): void {
    if (!IDEMPOTENCY_KEY.test(input.idempotencyKey) || !["PHONE_CALL", "PHYSICAL_VISIT"].includes(input.channel)) throw new BadRequestException({ code: "quick_lead_request_invalid" });
    if (!input.firstName?.trim() || !input.lastName?.trim() || (!input.email?.trim() && !input.phone?.trim())) throw new BadRequestException({ code: "quick_lead_identity_required" });
    if ((input.assignment.strategy === "FIXED") !== Boolean(input.assignment.targetUserId)) throw new BadRequestException({ code: "quick_lead_assignment_invalid" });
    if (input.nextActionAt && Number.isNaN(new Date(input.nextActionAt).valueOf())) throw new BadRequestException({ code: "quick_lead_follow_up_invalid" });
  }

  private assertRole(principal: Principal): void {
    if (!principal.roles.some((role) => role === "ADMISSIONS" || role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "quick_lead_role_forbidden" });
  }
}
