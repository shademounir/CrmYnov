import { ConflictException, Injectable } from "@nestjs/common";
import type { LeadClosureRequest as PrismaClosureRequest, LeadCollaborationRequest as PrismaCollaborationRequest, Prisma, ReassignmentRequest as PrismaReassignmentRequest } from "@prisma/client";
import type { ReassignmentRequest } from "../assignment/reassignment.service.js";
import type { ClosureRequest } from "../closure/closure.service.js";
import type { CollaborationRequest } from "../collaboration/lead-collaboration.service.js";
import { PrismaService } from "../persistence/prisma.service.js";

type WorkflowSnapshot = Readonly<{
  reassignments: ReassignmentRequest[];
  collaborations: CollaborationRequest[];
  closures: ClosureRequest[];
}>;

@Injectable()
export class LeadWorkflowPersistenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  get enabled(): boolean {
    return this.prisma.enabled && Boolean(this.prisma.client);
  }

  async snapshot(): Promise<WorkflowSnapshot> {
    const client = this.prisma.client;
    if (!client) return { reassignments: [], collaborations: [], closures: [] };
    const [reassignments, collaborations, closures] = await client.$transaction([
      client.reassignmentRequest.findMany({ orderBy: [{ requestedAt: "asc" }, { id: "asc" }] }),
      client.leadCollaborationRequest.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      client.leadClosureRequest.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    ]);
    return {
      reassignments: reassignments.map((row) => ({
        id: row.id, leadId: row.leadId, currentOwnerId: row.currentOwnerId, targetUserId: row.targetUserId,
        reason: row.reason, moveOpenTasks: row.moveOpenTasks, requestedBy: row.requestedBy,
        status: row.status as ReassignmentRequest["status"], requestedAt: row.requestedAt.toISOString(),
        ...(row.decidedBy ? { decidedBy: row.decidedBy } : {}),
        ...(row.decidedAt ? { decidedAt: row.decidedAt.toISOString() } : {}),
        ...(row.decisionReason ? { decisionReason: row.decisionReason } : {}),
      })),
      collaborations: collaborations.map((row) => ({
        id: row.id, leadId: row.leadId, targetUserId: row.targetUserId,
        action: row.action as CollaborationRequest["action"], role: row.role as CollaborationRequest["role"],
        justification: row.justification, requesterId: row.requesterId,
        state: row.state as CollaborationRequest["state"], version: row.version, createdAt: row.createdAt.toISOString(),
        ...(row.decidedAt ? { decidedAt: row.decidedAt.toISOString() } : {}),
        ...(row.decidedBy ? { decidedBy: row.decidedBy } : {}),
        ...(row.decisionReason ? { decisionReason: row.decisionReason } : {}),
      })),
      closures: closures.map((row) => ({
        id: row.id, leadId: row.leadId, target: row.target as ClosureRequest["target"], reason: row.reason,
        comment: row.comment, evidence: [...row.evidence], requesterId: row.requesterId,
        state: row.state as ClosureRequest["state"], version: row.version, createdAt: row.createdAt.toISOString(),
        ...(row.decidedAt ? { decidedAt: row.decidedAt.toISOString() } : {}),
        ...(row.decidedBy ? { decidedBy: row.decidedBy } : {}),
        ...(row.decisionReason ? { decisionReason: row.decisionReason } : {}),
      })),
    };
  }

  async createReassignment(item: ReassignmentRequest, idempotencyKey: string): Promise<ReassignmentRequest> {
    const client = this.requiredClient();
    return client.$transaction(async (tx) => {
      const replay = await tx.reassignmentRequest.findUnique({ where: { idempotencyKey } });
      if (replay) {
        if (replay.leadId !== item.leadId || replay.targetUserId !== item.targetUserId) throw new ConflictException({ code: "reassignment_idempotency_conflict" });
        return this.mapReassignment(replay);
      }
      const row = await tx.reassignmentRequest.create({ data: { ...this.reassignmentData(item), idempotencyKey } });
      return this.mapReassignment(row);
    }, { isolationLevel: "Serializable" });
  }

  async findReassignment(idempotencyKey: string): Promise<ReassignmentRequest | undefined> {
    const client = this.prisma.client;
    if (!client) return undefined;
    const row = await client.reassignmentRequest.findUnique({ where: { idempotencyKey } });
    return row ? this.mapReassignment(row) : undefined;
  }

  async decideReassignment(item: ReassignmentRequest, expectedVersion: number): Promise<ReassignmentRequest> {
    const client = this.requiredClient();
    return client.$transaction(async (tx) => {
      const updated = await tx.reassignmentRequest.updateMany({
        where: { id: item.id, status: "PENDING", version: expectedVersion },
        data: { status: item.status, decidedBy: item.decidedBy ?? null, decidedAt: item.decidedAt ? new Date(item.decidedAt) : null, decisionReason: item.decisionReason ?? null, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException({ code: "reassignment_concurrent_decision" });
      return this.mapReassignment(await tx.reassignmentRequest.findUniqueOrThrow({ where: { id: item.id } }));
    }, { isolationLevel: "Serializable" });
  }

  async saveCollaboration(item: CollaborationRequest, expectedVersion?: number): Promise<CollaborationRequest> {
    const client = this.requiredClient();
    return client.$transaction(async (tx) => {
      if (expectedVersion === undefined) {
        const row = await tx.leadCollaborationRequest.create({ data: this.collaborationData(item) });
        return this.mapCollaboration(row);
      }
      const updated = await tx.leadCollaborationRequest.updateMany({ where: { id: item.id, state: "PENDING", version: expectedVersion }, data: {
        state: item.state, version: { increment: 1 }, decidedAt: item.decidedAt ? new Date(item.decidedAt) : null,
        decidedBy: item.decidedBy ?? null, decisionReason: item.decisionReason ?? null,
      } });
      if (updated.count !== 1) throw new ConflictException({ code: "collaboration_concurrent_decision" });
      return this.mapCollaboration(await tx.leadCollaborationRequest.findUniqueOrThrow({ where: { id: item.id } }));
    }, { isolationLevel: "Serializable" });
  }

  async saveClosure(item: ClosureRequest, expectedVersion?: number): Promise<ClosureRequest> {
    const client = this.requiredClient();
    return client.$transaction(async (tx) => {
      if (expectedVersion === undefined) {
        return this.mapClosure(await tx.leadClosureRequest.create({ data: this.closureData(item) }));
      }
      const updated = await tx.leadClosureRequest.updateMany({ where: { id: item.id, state: "PENDING", version: expectedVersion }, data: {
        state: item.state, version: { increment: 1 }, decidedAt: item.decidedAt ? new Date(item.decidedAt) : null,
        decidedBy: item.decidedBy ?? null, decisionReason: item.decisionReason ?? null,
      } });
      if (updated.count !== 1) throw new ConflictException({ code: "closure_concurrent_decision" });
      return this.mapClosure(await tx.leadClosureRequest.findUniqueOrThrow({ where: { id: item.id } }));
    }, { isolationLevel: "Serializable" });
  }

  private requiredClient(): NonNullable<PrismaService["client"]> {
    if (!this.prisma.client) throw new Error("lead_workflow_persistence_unavailable");
    return this.prisma.client;
  }

  private reassignmentData(item: ReassignmentRequest): Prisma.ReassignmentRequestUncheckedCreateInput {
    return { id: item.id, leadId: item.leadId, currentOwnerId: item.currentOwnerId, targetUserId: item.targetUserId,
      reason: item.reason, moveOpenTasks: item.moveOpenTasks, requestedBy: item.requestedBy, status: item.status,
      requestedAt: new Date(item.requestedAt), version: 1 };
  }
  private collaborationData(item: CollaborationRequest): Prisma.LeadCollaborationRequestUncheckedCreateInput {
    return { id: item.id, leadId: item.leadId, targetUserId: item.targetUserId, action: item.action, role: item.role,
      justification: item.justification, requesterId: item.requesterId, state: item.state, version: item.version, createdAt: new Date(item.createdAt) };
  }
  private closureData(item: ClosureRequest): Prisma.LeadClosureRequestUncheckedCreateInput {
    return { id: item.id, leadId: item.leadId, target: item.target, reason: item.reason, comment: item.comment,
      evidence: [...item.evidence], requesterId: item.requesterId, state: item.state, version: item.version, createdAt: new Date(item.createdAt) };
  }
  private mapReassignment(row: PrismaReassignmentRequest): ReassignmentRequest {
    return { id: row.id, leadId: row.leadId, currentOwnerId: row.currentOwnerId, targetUserId: row.targetUserId,
      reason: row.reason, moveOpenTasks: row.moveOpenTasks, requestedBy: row.requestedBy, status: row.status as ReassignmentRequest["status"],
      requestedAt: row.requestedAt.toISOString(), ...(row.decidedBy ? { decidedBy: row.decidedBy } : {}),
      ...(row.decidedAt ? { decidedAt: row.decidedAt.toISOString() } : {}), ...(row.decisionReason ? { decisionReason: row.decisionReason } : {}) };
  }
  private mapCollaboration(row: PrismaCollaborationRequest): CollaborationRequest {
    return { id: row.id, leadId: row.leadId, targetUserId: row.targetUserId, action: row.action as CollaborationRequest["action"],
      role: row.role as CollaborationRequest["role"], justification: row.justification, requesterId: row.requesterId,
      state: row.state as CollaborationRequest["state"], version: row.version, createdAt: row.createdAt.toISOString(),
      ...(row.decidedAt ? { decidedAt: row.decidedAt.toISOString() } : {}), ...(row.decidedBy ? { decidedBy: row.decidedBy } : {}),
      ...(row.decisionReason ? { decisionReason: row.decisionReason } : {}) };
  }
  private mapClosure(row: PrismaClosureRequest): ClosureRequest {
    return { id: row.id, leadId: row.leadId, target: row.target as ClosureRequest["target"], reason: row.reason, comment: row.comment,
      evidence: [...row.evidence], requesterId: row.requesterId, state: row.state as ClosureRequest["state"], version: row.version,
      createdAt: row.createdAt.toISOString(), ...(row.decidedAt ? { decidedAt: row.decidedAt.toISOString() } : {}),
      ...(row.decidedBy ? { decidedBy: row.decidedBy } : {}), ...(row.decisionReason ? { decisionReason: row.decisionReason } : {}) };
  }
}
