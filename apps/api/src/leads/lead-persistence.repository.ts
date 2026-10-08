import { BadRequestException, ConflictException, Inject, Injectable, Optional, UnauthorizedException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { LeadActivity as PrismaLeadActivity, Prisma } from "@prisma/client";
import { PrismaService } from "../persistence/prisma.service.js";
import { LocalOutboxRepository } from "../outbox/local-outbox.repository.js";
import { validateLeadReferences } from "../references/reference.repository.js";
import type { Principal } from "../auth/auth.types.js";
import type { AssignmentAudit } from "../assignment/assignment-audit.js";
import type { ActivityCorrection, CorrectionReasonCode, LeadActivityRecord, LeadRecord } from "./lead.service.js";
import { DynamicPermissionRepository } from "../permissions/dynamic-repository.js";
import { currentPrincipal, permissionDenied, resourceEvaluationContext } from "../permissions/dynamic-context.js";
import { canonicalCampus } from "../permissions/dynamic-resources.js";
import { evaluatePermission } from "../permissions/dynamic-evaluator.js";
import { applicableCampusRule } from "../assignment/campus-assignment-policy.js";
import { readCampusRules } from "../assignment/campus-assignment.service.js";
import { prepareSheetAssignment, commitSheetAssignment, type SheetAssignment } from "../assignment/campus-assignment-resolver.js";
import { assignmentManagerRecipients, assignmentNotification } from "../assignment/assignment-notifications.js";
import { BASELINE_OPTIONAL_INFORMATION, mayPreserveBaselineUnknown } from "../bootstrap-import/baseline-unknown-fields.js";

type StoredLead = LeadRecord & { version: number };
type PersistentSnapshot = Readonly<{ leads: StoredLead[]; activities: LeadActivityRecord[] }>;
type SnapshotLeadRow = Prisma.LeadGetPayload<{ include: { collaborators: true; commercialQualifications: true } }>;
type PersistMutationInput = Readonly<{
  before: StoredLead;
  after: StoredLead;
  activities: readonly LeadActivityRecord[];
  idempotencyKey: string;
  operation: string;
  fingerprint: string;
  principal: Principal;
  correlationId: string;
  eventType: string;
  assignmentAudit?: AssignmentAudit;
}>;
const temperatureLabels: Readonly<Record<string, string>> = {
  COLD: "Froid",
  WARM: "Tiède",
  HOT: "Chaud",
  UNEVALUATED: "Non évalué",
};
const mutationEvents: Readonly<Record<string, string>> = {
  UPDATE_LEAD: "LEAD_UPDATED", ADD_ACTIVITY: "LEAD_ACTIVITY_ADDED", CORRECT_ACTIVITY: "LEAD_ACTIVITY_COMPENSATED",
  CHANGE_STATUS: "LEAD_STATUS_CHANGED", ASSIGN: "LEAD_ASSIGNED", REASSIGN: "LEAD_REASSIGNED", COLLABORATOR: "LEAD_COLLABORATOR_CHANGED",
  REASSIGNMENT_REQUEST: "REASSIGNMENT_REQUESTED", REASSIGNMENT_DECISION: "REASSIGNMENT_DECIDED",
  COLLABORATION_REQUEST: "COLLABORATION_REQUESTED", COLLABORATION_DECISION: "COLLABORATION_DECIDED", CLOSURE_DECISION: "CLOSURE_DECIDED",
};

@Injectable()
export class LeadPersistenceRepository {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(LocalOutboxRepository) private readonly outbox?: LocalOutboxRepository,
    @Optional() @Inject(DynamicPermissionRepository) private readonly permissions?: DynamicPermissionRepository,
  ) {}

  get enabled(): boolean {
    return this.prisma.enabled && Boolean(this.prisma.client);
  }

  fingerprint(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  async snapshot(): Promise<PersistentSnapshot> {
    const client = this.prisma.client;
    if (!client) return { leads: [], activities: [] };
    const [rows, activities] = await client.$transaction([
      client.lead.findMany({ include: {
        collaborators: { where: { active: true }, orderBy: { userId: "asc" } },
        commercialQualifications: { orderBy: [{ version: "desc" }, { id: "desc" }], take: 1 },
      } }),
      client.leadActivity.findMany({ orderBy: [{ occurredAt: "asc" }, { id: "asc" }] }),
    ]);
    const ownerIds = [...new Set(rows.flatMap((row) => row.assignedToId ? [row.assignedToId] : []))];
    const owners = this.permissions && ownerIds.length ? await client.collaborator.findMany({ where: { id: { in: ownerIds } }, select: { id: true, professionalDisplayName: true } }) : [];
    return {
      leads: rows.map((row) => { const label = owners.find((owner) => owner.id === row.assignedToId)?.professionalDisplayName?.trim();
        return { ...this.mapStoredLead(row), ...(label ? { assignedToLabel: label } : {}) }; }),
      activities: activities.map((row): LeadActivityRecord => ({
        id: row.id,
        leadId: row.leadId,
        type: row.type as LeadActivityRecord["type"],
        result: row.result,
        ...(row.note ? { note: row.note } : {}),
        authorId: row.authorId,
        ...(row.nextActionAt ? { nextActionAt: row.nextActionAt.toISOString() } : {}),
        correlationId: row.correlationId,
        occurredAt: row.occurredAt.toISOString(),
        ...(row.originalEventId && row.correctionOperation && row.correctionReasonCode && row.previousSnapshot
          ? {
              correction: {
                originalEventId: row.originalEventId,
                operation: row.correctionOperation as "CORRECT" | "CANCEL",
                reasonCode: row.correctionReasonCode as CorrectionReasonCode,
                previous: row.previousSnapshot as unknown as NonNullable<LeadActivityRecord["correction"]>["previous"],
                ...(row.replacementSnapshot
                  ? { replacement: row.replacementSnapshot as unknown as NonNullable<LeadActivityRecord["correction"]>["replacement"] }
                  : {}),
              } as ActivityCorrection,
            }
          : {}),
      })),
    };
  }

  async createLead(
    lead: StoredLead,
    activity: LeadActivityRecord,
    idempotencyKey: string,
    fingerprint: string,
    principal: Principal,
    correlationId: string,
  ): Promise<StoredLead> {
    this.requireAuditActor(principal);
    const client = this.requiredClient();
    const create = async (tx: Prisma.TransactionClient): Promise<StoredLead> => {
      const actor = this.permissions ? await currentPrincipal(tx, principal) : principal;
      if (this.permissions) {
        const campus = await canonicalCampus(tx, lead.campus);
        const context = await resourceEvaluationContext(tx, actor, { scope: "CAMPUS", campusKeys: campus.keys, active: true });
        if (!evaluatePermission(actor, "lead.create", await this.permissions.snapshots(tx), context).allowed) permissionDenied();
      }
      const receipt = await tx.leadMutationReceipt.findUnique({ where: { idempotencyKey } });
      if (receipt) return this.replay(receipt.fingerprint, fingerprint, receipt.result);
      const references = await validateLeadReferences(tx, lead);
      lead = { ...lead, ...references };
      const assignment = this.permissions ? await this.initialAssignment(tx, lead, idempotencyKey, actor) : undefined;
      if (assignment) lead = { ...lead, ...(assignment.targetUserId ? { assignedToId: assignment.targetUserId, ...(assignment.selection ? { assignmentMode: assignment.selection.strategy } : {}) } : {}),
        initialAssignment: { outcome: assignment.targetUserId ? "ASSIGNED" : "UNASSIGNED", reason: assignment.reason ?? "assignment_selected", configurationVersion: assignment.configurationVersion ?? 0, ruleId: assignment.selection?.ruleId ?? null } };
      await tx.lead.create({ data: this.leadCreateData(lead) });
      await tx.leadActivity.create({ data: this.activityData(activity, idempotencyKey) });
      await this.auditMutation(tx, "LEAD_CREATED", lead.id, 1, idempotencyKey, actor, correlationId);
      if (assignment?.targetUserId) {
        await commitSheetAssignment(tx, assignment, lead.id);
        await tx.leadActivity.create({ data: this.activityData({ ...activity, id: randomUUID(), type: "ASSIGNMENT_CHANGED", result: assignment.targetUserId }, `${idempotencyKey}:assignment`) });
        await this.auditMutation(tx, "LEAD_ASSIGNED", lead.id, 1, `${idempotencyKey}:assignment`, actor, correlationId, {
          origin: "AUTOMATIC", decisionRef: `initial-assignment:${createHash("sha256").update(idempotencyKey).digest("hex")}`,
          configurationVersion: assignment.configurationVersion ?? null, ruleId: assignment.selection?.ruleId ?? null,
          requestHash: fingerprint, selectedUserId: assignment.targetUserId,
        });
      } else if (assignment) {
        await tx.auditEvent.create({ data: { eventType: "LEAD_ASSIGNMENT_PENDING", resourceType: "LEAD", resourceId: lead.id, campusId: assignment.campusId ?? lead.campus,
          actorId: actor.userId, actorRoles: actor.roles, sessionId: actor.sessionId, correlationId, result: "SUCCESS",
          idempotencyKey: `initial-assignment:${createHash("sha256").update(idempotencyKey).digest("hex")}`, after: { ...lead.initialAssignment } } });
      }
      if (assignment?.targetUserId) await assignmentNotification(tx, assignment.targetUserId, lead.id, "ASSIGNMENT", idempotencyKey);
      else if (assignment && this.permissions) {
        const managers = await assignmentManagerRecipients(tx, lead.campus, await this.permissions.snapshots(tx), "lead.assign");
        for (const managerId of managers) await assignmentNotification(tx, managerId, lead.id, "ASSIGNMENT", idempotencyKey, "/collaborators");
      }
      await tx.leadMutationReceipt.create({
        data: { leadId: lead.id, idempotencyKey, fingerprint, operation: "CREATE", result: lead as unknown as Prisma.InputJsonValue },
      });
      await this.outbox?.enqueueInTransaction(tx, {
        topic: "LEAD.CREATED",
        aggregateType: "LEAD",
        aggregateId: lead.id,
        idempotencyKey: `outbox:${idempotencyKey}`,
        payload: { operation: "CREATE", status: lead.status, version: lead.version, ...(assignment ? { assignmentOutcome: lead.initialAssignment!.outcome,
          assignmentReason: lead.initialAssignment!.reason, configurationVersion: lead.initialAssignment!.configurationVersion } : {}) },
      });
      return lead;
    };
    return this.permissions ? this.permissions.transaction(create) : client.$transaction(create, { isolationLevel: "Serializable" });
  }

  private async initialAssignment(tx: Prisma.TransactionClient, lead: StoredLead, eventKey: string, actor: Principal): Promise<SheetAssignment> {
    if (!this.permissions) throw new Error("assignment_permission_store_unavailable");
    const campus = await canonicalCampus(tx, lead.campus);
    const context = await resourceEvaluationContext(tx, actor, { scope: "CAMPUS", campusKeys: campus.keys, active: true });
    const permissions = await this.permissions.snapshots(tx);
    if (!evaluatePermission(actor, "lead.create", permissions, context).allowed) permissionDenied();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(171, hashtext(${campus.id}))`;
    const configuration = await readCampusRules(tx, campus.id);
    const evidence = { eventKey, campusId: campus.id, configurationVersion: configuration.version };
    if (!configuration.automaticEnabled) return { ...evidence, reason: configuration.version ? "assignment_automation_disabled" : "assignment_configuration_absent" };
    const rule = applicableCampusRule(configuration.rules, lead.source, lead.campaign);
    if (!rule) return { ...evidence, reason: "assignment_configuration_absent" };
    try { return await prepareSheetAssignment(tx, { strategy: rule.strategy }, lead, campus.id, eventKey, 0, true, { commercialOnly: true, permissions }); }
    catch (error) {
      if (error instanceof ConflictException && (error.getResponse() as { code?: string }).code === "assignment_candidate_unavailable") return { ...evidence, reason: "assignment_candidate_unavailable" };
      throw error;
    }
  }

  async findActivity(idempotencyKey: string): Promise<LeadActivityRecord | undefined> {
    const client = this.prisma.client;
    if (!client) return undefined;
    const row = await client.leadActivity.findUnique({ where: { idempotencyKey } });
    return row ? this.mapActivity(row) : undefined;
  }

  async findMutationReplay(idempotencyKey: string, fingerprint: string): Promise<StoredLead | undefined> {
    const client = this.prisma.client;
    if (!client) return undefined;
    const receipt = await client.leadMutationReceipt.findUnique({ where: { idempotencyKey } });
    return receipt ? this.replay(receipt.fingerprint, fingerprint, receipt.result) : undefined;
  }

  async persistMutation(
    before: StoredLead,
    after: StoredLead,
    activities: readonly LeadActivityRecord[],
    idempotencyKey: string,
    operation: string,
    fingerprint: string,
    principal: Principal,
    correlationId: string,
    assignmentAudit?: AssignmentAudit,
  ): Promise<StoredLead> {
    this.requireAuditActor(principal);
    const eventType = mutationEvents[operation];
    if (!eventType) throw new Error("lead_audit_operation_unknown");
    const client = this.requiredClient();
    const input: PersistMutationInput = {
      before, after, activities, idempotencyKey, operation, fingerprint, principal, correlationId, eventType,
      ...(assignmentAudit ? { assignmentAudit } : {}),
    };
    return client.$transaction((tx) => this.persistMutationInTransaction(tx, input), { isolationLevel: "Serializable" });
  }

  private mapStoredLead(row: SnapshotLeadRow): StoredLead {
    const qualification = row.commercialQualifications?.[0];
    const acquisitionKind = row.acquisitionKind === "BASELINE" ? "BASELINE" : "NEW";
    const historicalTemperature = acquisitionKind === "BASELINE" && ["COLD", "WARM", "HOT"].includes(row.baselineTemperature ?? "")
      ? row.baselineTemperature : undefined;
    const temperature = (qualification?.temperature ?? historicalTemperature ?? "UNEVALUATED") as NonNullable<LeadRecord["temperature"]>;
    return {
      id: row.id,
      leadCode: row.leadCode,
      firstName: row.firstName,
      lastName: row.lastName,
      ...(row.email ? { email: row.email } : {}),
      ...(row.phone ? { phone: row.phone } : {}),
      campus: row.campus,
      campaign: row.campaign,
      educationLevel: row.educationLevel,
      program: row.program,
      source: row.source,
      status: row.status as LeadRecord["status"],
      acquisitionKind,
      ...(row.assignedToId ? { assignedToId: row.assignedToId } : {}),
      collaboratorIds: row.collaborators.map((item) => item.userId),
      ...(row.assignmentMode ? { assignmentMode: row.assignmentMode } : {}),
      ...(row.importBatchId ? { importBatchId: row.importBatchId } : {}),
      ...(row.nextActionAt ? { nextActionAt: row.nextActionAt.toISOString() } : {}),
      ...(row.lastActivityAt ? { lastActivityAt: row.lastActivityAt.toISOString() } : {}),
      createdAt: row.createdAt.toISOString(),
      version: row.version,
      temperature,
      temperatureSource: qualification ? "HUMAN_QUALIFICATION" : historicalTemperature ? "HISTORICAL_BASELINE" : "UNEVALUATED",
      temperatureLabel: temperatureLabels[temperature] ?? "Non évalué",
      qualificationVersion: qualification?.version ?? 0,
      ...(qualification?.reason ? { qualificationReason: qualification.reason } : {}),
      ...(qualification?.comment ? { qualificationComment: qualification.comment } : {}),
      ...(qualification?.createdAt ? { qualifiedAt: qualification.createdAt.toISOString() } : {}),
      ...(qualification?.authorId ? { qualifiedBy: qualification.authorId } : {}),
    };
  }

  private async persistMutationInTransaction(tx: Prisma.TransactionClient, input: PersistMutationInput): Promise<StoredLead> {
    const receipt = await tx.leadMutationReceipt.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (receipt) return this.replay(receipt.fingerprint, input.fingerprint, receipt.result);
    let allowMissingBaselineProgram = false;
    if (BASELINE_OPTIONAL_INFORMATION.some((field) => !input.after[field].trim())) {
      // The read, permission-fenced mutation and optimistic UPDATE share this
      // transaction. A forged/stale before snapshot cannot grant the exception.
      const current = await tx.lead.findUnique({ where: { id: input.before.id }, select: { acquisitionKind: true, program: true, educationLevel: true, version: true } });
      if (!current || current.version !== input.before.version) throw new ConflictException({ code: "lead_concurrent_mutation" });
      if (BASELINE_OPTIONAL_INFORMATION.some((field) => !input.after[field].trim() && !mayPreserveBaselineUnknown(current, field))) throw new BadRequestException({ code: "lead_required_field_missing" });
      allowMissingBaselineProgram = mayPreserveBaselineUnknown(current, "program");
    }
    const references = await validateLeadReferences(tx, input.after, input.before, { allowMissingBaselineProgram });
    const after = { ...input.after, ...references };
    await this.assertNoContactCollision(tx, input.operation, after);
    await this.updateLeadVersion(tx, input.before, after);
    await this.appendActivities(tx, input.activities, input.idempotencyKey);
    const result: StoredLead = { ...after, version: input.before.version + 1 };
    await this.persistMutationRelations(tx, input, result);
    return result;
  }

  private async assertNoContactCollision(tx: Prisma.TransactionClient, operation: string, after: StoredLead): Promise<void> {
    if (operation !== "UPDATE_LEAD" || (!after.email && !after.phone)) return;
    const alternatives = [
      ...(after.email ? [{ email: { equals: after.email, mode: "insensitive" as const } }] : []),
      ...(after.phone ? [{ phone: after.phone }] : []),
    ];
    const collision = await tx.lead.findFirst({
      where: { id: { not: after.id }, OR: alternatives },
      select: { email: true, phone: true },
    });
    if (!collision) return;
    const fields = [
      collision.email?.toLowerCase() === after.email?.toLowerCase() ? "email" : undefined,
      collision.phone === after.phone ? "phone" : undefined,
    ].filter((field): field is string => Boolean(field));
    throw new ConflictException({ code: "lead_contact_collision", fields });
  }

  private async updateLeadVersion(tx: Prisma.TransactionClient, before: StoredLead, after: StoredLead): Promise<void> {
    const updated = await tx.lead.updateMany({
      where: { id: before.id, version: before.version },
      data: {
        firstName: after.firstName,
        lastName: after.lastName,
        email: after.email ?? null,
        phone: after.phone ?? null,
        campus: after.campus,
        campaign: after.campaign,
        educationLevel: after.educationLevel,
        program: after.program,
        source: after.source,
        status: after.status,
        assignedToId: after.assignedToId ?? null,
        assignmentMode: after.assignmentMode ?? null,
        nextActionAt: after.nextActionAt ? new Date(after.nextActionAt) : null,
        lastActivityAt: after.lastActivityAt ? new Date(after.lastActivityAt) : null,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new ConflictException({ code: "lead_concurrent_mutation" });
  }

  private async appendActivities(tx: Prisma.TransactionClient, activities: readonly LeadActivityRecord[], idempotencyKey: string): Promise<void> {
    for (const [index, activity] of activities.entries()) {
      const key = activities.length === 1 ? idempotencyKey : `${idempotencyKey}:${index}`;
      await tx.leadActivity.create({ data: this.activityData(activity, key) });
    }
  }

  private async persistMutationRelations(tx: Prisma.TransactionClient, input: PersistMutationInput, result: StoredLead): Promise<void> {
    if (input.operation === "COLLABORATOR") await this.replaceCollaboratorsInTransaction(tx, result.id, result.collaboratorIds ?? []);
    const assignment = input.operation === "ASSIGN" ? input.assignmentAudit : undefined;
    await this.auditMutation(tx, input.eventType, result.id, result.version, input.idempotencyKey, input.principal, input.correlationId, assignment);
    await tx.leadMutationReceipt.create({
      data: { leadId: result.id, idempotencyKey: input.idempotencyKey, fingerprint: input.fingerprint, operation: input.operation, result: result as unknown as Prisma.InputJsonValue },
    });
    await this.outbox?.enqueueInTransaction(tx, {
      topic: "LEAD.MUTATED",
      aggregateType: "LEAD",
      aggregateId: result.id,
      idempotencyKey: `outbox:${input.idempotencyKey}`,
      payload: { operation: input.operation, status: result.status, version: result.version, activityTypes: input.activities.map((activity) => activity.type) },
    });
  }

  async replaceCollaborators(leadId: string, userIds: readonly string[]): Promise<void> {
    const client = this.requiredClient();
    await client.$transaction((tx) => this.replaceCollaboratorsInTransaction(tx, leadId, userIds), { isolationLevel: "Serializable" });
  }

  private async replaceCollaboratorsInTransaction(tx: Prisma.TransactionClient, leadId: string, userIds: readonly string[]): Promise<void> {
      await tx.leadCollaborator.updateMany({ where: { leadId, active: true, userId: { notIn: [...userIds] } }, data: { active: false } });
      for (const userId of userIds) {
        await tx.leadCollaborator.upsert({
          where: { leadId_userId: { leadId, userId } },
          create: { leadId, userId, active: true },
          update: { active: true },
        });
      }
  }

  private requiredClient(): NonNullable<PrismaService["client"]> {
    if (!this.prisma.client) throw new Error("lead_persistence_unavailable");
    return this.prisma.client;
  }

  private requireAuditActor(principal: Principal): void {
    if (!principal?.userId || !principal.sessionId || !principal.roles.length) throw new UnauthorizedException({ code: "audit_actor_required" });
  }

  private async auditMutation(tx: Prisma.TransactionClient, eventType: string, leadId: string, version: number, key: string, principal: Principal, correlationId: string, assignment?: AssignmentAudit): Promise<void> {
    const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId }, select: { campus: true } });
    const automatic = eventType === "LEAD_ASSIGNED" && assignment?.origin === "AUTOMATIC";
    const campusId = automatic ? (await canonicalCampus(tx, lead.campus)).id : lead.campus;
    await tx.auditEvent.create({ data: { eventType, campusId, ...(automatic ? { sessionId: principal.sessionId } : {}), resourceType: "LEAD", resourceId: leadId, actorId: principal.userId, actorRoles: principal.roles, correlationId, result: "SUCCESS", idempotencyKey: assignment?.decisionRef ?? `lead-audit:${createHash("sha256").update(key).digest("hex")}`, after: { version, scope: "CAMPUS", ...(assignment ? { ...assignment } : {}) } } });
  }

  private replay(storedFingerprint: string, fingerprint: string, result: Prisma.JsonValue): StoredLead {
    if (storedFingerprint !== fingerprint) throw new ConflictException({ code: "lead_idempotency_conflict" });
    return structuredClone(result) as unknown as StoredLead;
  }

  private leadCreateData(lead: StoredLead): Prisma.LeadUncheckedCreateInput {
    return {
      id: lead.id,
      leadCode: lead.leadCode,
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: lead.email ?? null,
      phone: lead.phone ?? null,
      campus: lead.campus,
      campaign: lead.campaign,
      educationLevel: lead.educationLevel,
      program: lead.program,
      source: lead.source,
      status: lead.status,
      assignedToId: lead.assignedToId ?? null,
      assignmentMode: lead.assignmentMode ?? null,
      importBatchId: lead.importBatchId ?? null,
      nextActionAt: lead.nextActionAt ? new Date(lead.nextActionAt) : null,
      lastActivityAt: lead.lastActivityAt ? new Date(lead.lastActivityAt) : null,
      createdAt: new Date(lead.createdAt),
      version: lead.version,
    };
  }

  private activityData(activity: LeadActivityRecord, idempotencyKey: string): Prisma.LeadActivityUncheckedCreateInput {
    return {
      id: activity.id,
      leadId: activity.leadId,
      type: activity.type,
      result: activity.result,
      note: activity.note ?? null,
      authorId: activity.authorId,
      nextActionAt: activity.nextActionAt ? new Date(activity.nextActionAt) : null,
      correlationId: activity.correlationId,
      idempotencyKey,
      originalEventId: activity.correction?.originalEventId ?? null,
      correctionOperation: activity.correction?.operation ?? null,
      correctionReasonCode: activity.correction?.reasonCode ?? null,
      ...(activity.correction?.previous ? { previousSnapshot: activity.correction.previous as unknown as Prisma.InputJsonValue } : {}),
      ...(activity.correction?.replacement ? { replacementSnapshot: activity.correction.replacement as unknown as Prisma.InputJsonValue } : {}),
      occurredAt: new Date(activity.occurredAt),
    };
  }

  private mapActivity(row: PrismaLeadActivity): LeadActivityRecord {
    return {
      id: row.id, leadId: row.leadId, type: row.type as LeadActivityRecord["type"], result: row.result,
      ...(row.note ? { note: row.note } : {}), authorId: row.authorId,
      ...(row.nextActionAt ? { nextActionAt: row.nextActionAt.toISOString() } : {}), correlationId: row.correlationId,
      occurredAt: row.occurredAt.toISOString(),
      ...(row.originalEventId && row.correctionOperation && row.correctionReasonCode && row.previousSnapshot ? {
        correction: { originalEventId: row.originalEventId, operation: row.correctionOperation as "CORRECT" | "CANCEL",
          reasonCode: row.correctionReasonCode as CorrectionReasonCode,
          previous: row.previousSnapshot as unknown as NonNullable<LeadActivityRecord["correction"]>["previous"],
          ...(row.replacementSnapshot ? { replacement: row.replacementSnapshot as unknown as NonNullable<LeadActivityRecord["correction"]>["replacement"] } : {}) } as ActivityCorrection,
      } : {}),
    };
  }
}
