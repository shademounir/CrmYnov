import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Principal } from "../auth/auth.types.js";
import { DynamicPermissionRepository } from "../permissions/dynamic-repository.js";
import { currentPrincipal, permissionDenied, resourceEvaluationContext } from "../permissions/dynamic-context.js";
import { evaluatePermission } from "../permissions/dynamic-evaluator.js";
import { canonicalCampus } from "../permissions/dynamic-resources.js";
import { AssignmentService, type AssignmentRuleInput, type AssignmentRule } from "./assignment.service.js";
import { parseCampusRules } from "./campus-assignment-policy.js";
import type { LeadAssignmentSnapshot } from "../leads/lead.service.js";

export interface CampusRules { campusId: string; version: number; rules: AssignmentRuleInput[] }
export interface AssignmentReportingSnapshot { rules: AssignmentRule[]; automaticDecisions: number; assignedByBatch: number; leads: LeadAssignmentSnapshot; pendingReassignments: number }
export interface CampusAssignmentHistory {
  campusId: string;
  rules: Array<{ version: number; rules: AssignmentRuleInput[] }>;
  decisions: Array<{ id: string; action: string; resourceId: string; createdAt: string; context: Prisma.JsonValue }>;
  nextCursor: string | null;
}
export async function readCampusRules(tx: Prisma.TransactionClient, campusId: string): Promise<CampusRules> {
  const configuration = await tx.campusAssignmentConfiguration.findUnique({ where: { campusId } });
  if (!configuration) return { campusId, version: 0, rules: [] };
  const snapshot = await tx.campusAssignmentVersion.findUniqueOrThrow({ where: { campusId_version: { campusId, version: configuration.version } } });
  return { campusId, version: snapshot.version, rules: parseCampusRules(snapshot.rules) };
}

@Injectable()
export class CampusAssignmentService {
  constructor(@Inject(DynamicPermissionRepository) private readonly repository: DynamicPermissionRepository,
    @Inject(AssignmentService) private readonly engine: AssignmentService) {}

  async reporting(actor: Principal): Promise<AssignmentReportingSnapshot> {
    return this.repository.readTransaction(async (tx) => {
      const current = await currentPrincipal(tx, actor);
      const snapshots = await this.repository.snapshots(tx);
      const references = await tx.crmReference.findMany({ where: { kind: "CAMPUS", state: "ACTIVE" } });
      const campusIds: string[] = [];
      const campusKeys: string[] = [];
      for (const reference of references) {
        const campus = await canonicalCampus(tx, reference.id);
        const context = await resourceEvaluationContext(tx, current, { scope: "CAMPUS", campusKeys: campus.keys, active: true });
        if (context.campusAllowed && evaluatePermission(current, "reporting.view", snapshots, context).allowed) { campusIds.push(campus.id); campusKeys.push(...campus.keys); }
      }
      const configurations = await tx.campusAssignmentConfiguration.findMany({ where: { campusId: { in: campusIds } } });
      const rules: AssignmentRule[] = [];
      for (const configuration of configurations) {
        const version = await tx.campusAssignmentVersion.findUniqueOrThrow({ where: { campusId_version: configuration } });
        for (const rule of parseCampusRules(version.rules)) {
          if (!rule.id) throw new ConflictException({ code: "assignment_rule_invalid" });
          const cursor = await tx.campusAssignmentCursor.findUnique({ where: { campusId_version_ruleId: { ...configuration, ruleId: rule.id } } });
          rules.push({ ...rule, id: rule.id, version: version.version, cursor: cursor?.cursor ?? 0, updatedAt: version.createdAt.toISOString(), updatedBy: version.actorId });
        }
      }
      const automaticDecisions = await tx.auditEvent.count({ where: { campusId: { in: campusIds }, eventType: "ASSIGNMENT_DECISION_CREATED", result: "SUCCESS" } });
      const assignedByBatch = await tx.auditEvent.count({ where: { campusId: { in: campusIds }, eventType: "LEAD_AUTO_ASSIGNED", result: "SUCCESS" } });
      const rows = await tx.lead.findMany({ where: { campus: { in: campusKeys } }, select: { assignedToId: true, nextActionAt: true } });
      const counts = new Map<string, number>();
      for (const row of rows) if (row.assignedToId) counts.set(row.assignedToId, (counts.get(row.assignedToId) ?? 0) + 1);
      const assigned = rows.filter((row) => row.assignedToId).length;
      const now = new Date();
      const leads = { total: rows.length, assigned, unassigned: rows.length - assigned,
        followUpDue: rows.filter((row) => row.nextActionAt && row.nextActionAt <= now).length,
        byAdviser: [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([userId, leadCount]) => ({ userId, leadCount })) };
      const pendingReassignments = await tx.reassignmentRequest.count({ where: { status: "PENDING", lead: { campus: { in: campusKeys } } } });
      return { rules, automaticDecisions, assignedByBatch, leads, pendingReassignments };
    });
  }

  async history(actor: Principal, campusValue: string, cursor?: string): Promise<CampusAssignmentHistory> {
    if (cursor && !/^[a-f\d-]{36}$/iu.test(cursor)) throw new BadRequestException({ code: "assignment_history_cursor_invalid" });
    return this.repository.readTransaction(async (tx) => {
      const { campusId } = await this.authorize(tx, actor, campusValue, "lead.assign");
      const versions = await tx.campusAssignmentVersion.findMany({ where: { campusId }, orderBy: { version: "desc" }, take: 100 });
      const events = await tx.auditEvent.findMany({ where: { campusId, eventType: { in: ["ASSIGNMENT_DECISION_CREATED", "LEAD_AUTO_ASSIGNED", "IMPORT_ASSIGNMENT_RESOLVED", "SHEET_IMPORT_ROW_PROCESSED"] },
        ...(cursor ? { id: { lt: cursor } } : {}) }, orderBy: { id: "desc" }, take: 51 });
      const page = events.slice(0, 50);
      return { campusId, rules: versions.map((row) => ({ version: row.version, rules: parseCampusRules(row.rules) })),
        decisions: page.map((row) => ({ id: row.id, action: row.eventType, resourceId: row.resourceId ?? "", createdAt: row.occurredAt.toISOString(), context: this.recordedContext(row.after) })),
        nextCursor: events.length > 50 ? page.at(-1)?.id ?? null : null };
    });
  }

  private recordedContext(value: Prisma.JsonValue | null): Prisma.JsonValue {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const permitted = new Set(["configurationVersion", "version", "ruleId", "selectedUserId", "assignedToId", "candidateFingerprint", "strategy", "reason", "algorithmVersion"]);
    const source = value.assignment && typeof value.assignment === "object" && !Array.isArray(value.assignment) ? value.assignment : value;
    return Object.fromEntries(Object.entries(source).filter(([key, item]) => permitted.has(key) && (item === null || typeof item === "string" || typeof item === "number")));
  }

  async read(actor: Principal, campusValue: string): Promise<CampusRules> {
    return this.repository.readTransaction(async (tx) => {
      const { campusId } = await this.authorize(tx, actor, campusValue, "lead.assign");
      return readCampusRules(tx, campusId);
    });
  }

  async configure(actor: Principal, campusValue: string, expectedVersion: number, input: unknown, correlationId: string): Promise<CampusRules> {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new BadRequestException({ code: "assignment_version_invalid" });
    const parsed = parseCampusRules(input);
    return this.repository.transaction(async (tx) => {
      const { campusId, current } = await this.authorize(tx, actor, campusValue, "settings.campus.manage");
      // Same per-campus lock as the worker; immutable versions never overwrite an old decision.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(171, hashtext(${campusId}))`;
      const previous = await readCampusRules(tx, campusId);
      if (previous.version !== expectedVersion) throw new ConflictException({ code: "assignment_version_conflict" });
      const rules = parsed.length ? this.engine.snapshotRules(parsed, current.userId) : [];
      for (const rule of rules) for (const candidate of rule.candidates) {
        const user = await tx.collaborator.findUnique({ where: { id: candidate.userId } });
        if (!user?.active || !user.campusId || !user.roles.some((role) => role === "ADMISSIONS" || role === "MANAGER")) permissionDenied();
        if ((await canonicalCampus(tx, user.campusId)).id !== campusId) permissionDenied();
      }
      const version = expectedVersion + 1;
      if (expectedVersion === 0) await tx.campusAssignmentConfiguration.create({ data: { campusId, version } });
      else await tx.campusAssignmentConfiguration.update({ where: { campusId, version: expectedVersion }, data: { version } });
      await tx.campusAssignmentVersion.create({ data: { campusId, version, actorId: current.userId,
        rules: rules.map((rule) => ({ ...rule, candidates: rule.candidates.map((candidate) => ({ ...candidate })) })) } });
      await tx.auditEvent.create({ data: { actorId: current.userId, actorRoles: current.roles, campusId, resourceType: "ASSIGNMENT_CONFIGURATION", resourceId: campusId,
        eventType: "CAMPUS_ASSIGNMENT_CONFIGURED", result: "SUCCESS", correlationId, idempotencyKey: `campus-assignment:${campusId}:${version}`,
        after: { version, ruleIds: rules.map((rule) => rule.id), ruleCount: rules.length } } });
      return { campusId, version, rules };
    });
  }

  private async authorize(tx: Prisma.TransactionClient, actor: Principal, value: string, permission: string): Promise<{ campusId: string; current: Principal }> {
    if (typeof value !== "string" || !value.trim()) throw new BadRequestException({ code: "assignment_campus_required" });
    const current = await currentPrincipal(tx, actor);
    if (!current.roles.some((role) => ["ADMIN", "SUPER_ADMIN", "MANAGER"].includes(role))) permissionDenied();
    const campus = await canonicalCampus(tx, value);
    const context = await resourceEvaluationContext(tx, current, { scope: "CAMPUS", campusKeys: campus.keys, active: true });
    if (!evaluatePermission(current, permission, await this.repository.snapshots(tx), context).allowed) permissionDenied();
    return { campusId: campus.id, current };
  }
}
