import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { CrmReference, Prisma } from "@prisma/client";
import type { Principal } from "../auth/auth.types.js";
import { PermissionService, type PermissionKey, type ResourceContext } from "../permissions/permission.service.js";
import { ReferenceRepository, resolveReference, unknownReference, validateLeadReferences, type ReferenceTransaction } from "./reference.repository.js";
import { referenceId, referenceKey, referenceKinds, referenceText, referenceVersion, strictBody, validateAliases, validateReferenceInput, validateReferenceScope, type ReferenceInput, type ReferenceKind, type ReferenceUpdate, type TagAssignment } from "./reference.contract.js";

@Injectable()
export class ReferenceService {
  constructor(@Inject(ReferenceRepository) private readonly repository: ReferenceRepository, @Inject(PermissionService) private readonly permissions: PermissionService) {}

  async validateForLead(values: { campus?: string; program?: string; campaign?: string }, principal: Principal, leadId?: string): Promise<void> {
    await this.repository.transaction(async (tx) => {
      if (leadId) await this.leadContext(tx, leadId, principal);
      const previous = leadId ? await tx.lead.findUnique({ where: { id: leadId } }) : null;
      if (leadId && !previous) throw new NotFoundException({ code: "lead_not_found" });
      const merged = { campus: values.campus ?? previous?.campus ?? "", program: values.program ?? previous?.program ?? "", campaign: values.campaign ?? previous?.campaign ?? "" };
      const campus = await resolveReference(tx, "CAMPUS", merged.campus);
      const changed = !previous || Object.entries(merged).some(([key, value]) => value !== previous[key as "campus" | "program" | "campaign"]);
      if (!changed) return;
      if (!campus) unknownReference("campus");
      await this.permissions.assertCan(principal, "lead.references.view", { scope: "CAMPUS", active: campus.state === "ACTIVE", campusKeys: await this.campusKeys(tx, campus) });
      await validateLeadReferences(tx, merged, previous ?? undefined);
    });
  }

  async list(kind: ReferenceKind, principal: Principal, options: { campusId?: string; includeArchived?: boolean; leadId?: string } = {}): Promise<CrmReference[]> {
    if (!referenceKinds.includes(kind)) throw new BadRequestException({ code: "reference_kind_invalid" });
    return this.repository.transaction(async (tx) => {
      const lead = options.leadId ? await this.leadContext(tx, options.leadId, principal) : undefined;
      const campus = options.campusId ? await this.campus(tx, options.campusId) : undefined;
      if (campus) await this.permissions.assertCan(principal, "lead.references.view", { scope: "CAMPUS", campusKeys: await this.campusKeys(tx, campus), active: true, readableResource: Boolean(lead?.readableResource && lead.campusKeys.includes(campus.id)) });
      const rows = await tx.crmReference.findMany({ where: { kind, ...(options.includeArchived ? {} : { state: "ACTIVE" }), ...(campus ? { OR: [{ campusId: campus.id }, { scope: "GLOBAL" }] } : {}) }, orderBy: [{ label: "asc" }, { id: "asc" }] });
      const allowed: CrmReference[] = [];
      for (const row of rows) {
        const context = await this.context(tx, row);
        if (lead && row.scope === "CAMPUS" && !lead.campusKeys.some((key) => context.campusKeys.includes(key))) continue;
        context.readableResource = Boolean(options.leadId && lead?.readableResource && await this.usedByLead(tx, row, options.leadId));
        if (row.kind === "CAMPUS") context.active = context.active && this.hasCampus(principal, await this.campusKeys(tx, row));
        if (row.kind === "PROGRAM" && !campus) {
          const availability = await tx.crmProgramAvailability.findMany({ where: { programId: row.id, active: true } });
          const keys = await Promise.all(availability.map(async (item) => this.campusKeys(tx, await this.get(tx, item.campusId))));
          context.active = context.active && keys.some((value) => this.hasCampus(principal, value));
        }
        if (!await this.permissions.can(principal, "lead.references.view", context)) continue;
        if (kind === "PROGRAM" && campus) {
          const availability = await tx.crmProgramAvailability.findUnique({ where: { programId_campusId: { programId: row.id, campusId: campus.id } } });
          if (!availability?.active) continue;
        }
        allowed.push(row);
      }
      return allowed;
    });
  }

  async create(raw: ReferenceInput, principal: Principal, correlationId: string): Promise<CrmReference> {
    const input = validateReferenceInput(raw);
    return this.repository.transaction(async (tx) => {
      const context = await this.definitionContext(tx, input.scope, input.campusId);
      await this.permissions.assertCan(principal, this.managePermission(input.kind), context);
      const scopeKey = input.campusId ?? "GLOBAL";
      const row = await tx.crmReference.create({ data: { kind: input.kind, code: input.code, label: input.label, scope: input.scope, campusId: input.campusId, scopeKey } });
      await this.keys(tx, row, [input.code, input.label, ...(input.aliases ?? [])]);
      await this.audit(tx, "REFERENCE_CREATED", row.id, principal, correlationId, { kind: row.kind, scope: row.scope, version: row.version });
      return row;
    });
  }

  async update(id: string, input: ReferenceUpdate, principal: Principal, correlationId: string): Promise<CrmReference> {
    referenceId(id); strictBody(input, ["label", "state", "scope", "campusId", "aliases", "expectedVersion"]);
    referenceVersion(input.expectedVersion); validateAliases(input.aliases);
    if (input.state !== undefined && !["ACTIVE", "ARCHIVED"].includes(input.state)) throw new BadRequestException({ code: "reference_state_invalid" });
    return this.repository.transaction(async (tx) => {
      const current = await this.get(tx, id);
      await this.permissions.assertCan(principal, this.managePermission(current.kind), await this.context(tx, current));
      if (input.state !== undefined && current.kind !== "TAG") await this.permissions.assertCan(principal, "lead.references.archive", await this.context(tx, current));
      if (current.version !== input.expectedVersion) throw new ConflictException({ code: "reference_version_conflict" });
      if (current.state === "LEGACY") throw new ConflictException({ code: "reference_legacy_immutable" });
      const scope = input.scope ?? current.scope;
      const campusId = input.campusId === undefined ? current.campusId : input.campusId;
      validateReferenceScope(current.kind, scope, campusId);
      if (scope !== current.scope || campusId !== current.campusId) {
        await this.permissions.assertCan(principal, this.managePermission(current.kind), await this.definitionContext(tx, scope, campusId));
        if (await tx.crmLeadTag.count({ where: { tagId: id } }) || await this.campaignInUse(tx, current)) throw new ConflictException({ code: "reference_scope_in_use" });
      }
      const next = await tx.crmReference.update({ where: { id, version: input.expectedVersion }, data: { ...(input.label !== undefined ? { label: referenceText(input.label) } : {}), ...(input.state ? { state: input.state } : {}), scope, campusId, scopeKey: campusId ?? "GLOBAL", version: { increment: 1 } } });
      if (next.scopeKey !== current.scopeKey) await tx.crmReferenceKey.updateMany({ where: { referenceId: id }, data: { scopeKey: next.scopeKey, version: next.version } });
      await this.keys(tx, next, [next.label, ...(input.aliases ?? [])]);
      await this.audit(tx, "REFERENCE_UPDATED", id, principal, correlationId, { kind: next.kind, scope: next.scope, state: next.state, version: next.version }, { scope: current.scope, state: current.state, version: current.version });
      return next;
    });
  }

  async availability(programId: string, campusId: string, active: boolean, expectedVersion: number, principal: Principal, correlationId: string): Promise<{ active: boolean; version: number }> {
    referenceId(programId); referenceId(campusId);
    if (typeof active !== "boolean" || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new BadRequestException({ code: "availability_input_invalid" });
    return this.repository.transaction(async (tx) => {
      const program = await this.get(tx, programId); const campus = await this.campus(tx, campusId);
      if (program.kind !== "PROGRAM" || program.state !== "ACTIVE") unknownReference("program");
      await this.permissions.assertCan(principal, "settings.campus.manage", { scope: "CAMPUS", campusKeys: await this.campusKeys(tx, campus), active: true });
      const where = { programId_campusId: { programId, campusId } };
      const current = await tx.crmProgramAvailability.findUnique({ where });
      if ((current?.version ?? 0) !== expectedVersion) throw new ConflictException({ code: "reference_version_conflict" });
      const result = await tx.crmProgramAvailability.upsert({ where, create: { programId, campusId, active }, update: { active, version: { increment: 1 } } });
      await this.audit(tx, "PROGRAM_AVAILABILITY_CHANGED", programId, principal, correlationId, { campusId, active, version: result.version });
      return { active: result.active, version: result.version };
    });
  }

  async readAvailability(programId: string, campusId: string, principal: Principal): Promise<{ active: boolean; version: number }> {
    return this.repository.transaction(async (tx) => {
      const program = await this.get(tx, programId); const campus = await this.campus(tx, campusId);
      if (program.kind !== "PROGRAM" || program.state !== "ACTIVE") unknownReference("program");
      await this.permissions.assertCan(principal, "settings.campus.manage", { scope: "CAMPUS", campusKeys: await this.campusKeys(tx, campus), active: true });
      const row = await tx.crmProgramAvailability.findUnique({ where: { programId_campusId: { programId, campusId } } });
      return { active: row?.active ?? false, version: row?.version ?? 0 };
    });
  }

  async leadTags(leadId: string, principal: Principal): Promise<{ items: CrmReference[]; version: number; canAssign: boolean }> {
    return this.repository.transaction(async (tx) => {
      const context = await this.leadContext(tx, leadId, principal);
      await this.permissions.assertCan(principal, "lead.references.view", context);
      const tags = await tx.crmLeadTag.findMany({ where: { leadId, active: true }, include: { tag: true }, orderBy: { tagId: "asc" } });
      const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId }, select: { version: true } });
      return { items: tags.map((row) => row.tag), version: lead.version, canAssign: await this.permissions.can(principal, "lead.tags.assign", context) };
    });
  }

  async assignTags(leadId: string, input: TagAssignment, principal: Principal, correlationId: string): Promise<{ tagIds: string[]; version: number }> {
    referenceId(leadId); strictBody(input, ["tagIds", "expectedVersion", "idempotencyKey"]); referenceVersion(input.expectedVersion);
    if (!Array.isArray(input.tagIds) || input.tagIds.length > 30 || new Set(input.tagIds).size !== input.tagIds.length || typeof input.idempotencyKey !== "string" || !/^[a-zA-Z0-9:_-]{8,80}$/.test(input.idempotencyKey)) throw new BadRequestException({ code: "tag_assignment_invalid" });
    input.tagIds.forEach(referenceId);
    return this.repository.transaction(async (tx) => {
      const context = await this.leadContext(tx, leadId, principal);
      await this.permissions.assertCan(principal, "lead.tags.assign", context);
      const tagIds = [...input.tagIds].sort();
      const idempotencyKey = `tags:${leadId}:${input.idempotencyKey}`;
      const fingerprint = createHash("sha256").update(JSON.stringify({ tagIds, actorId: principal.userId, version: input.expectedVersion })).digest("hex");
      const receipt = await tx.leadMutationReceipt.findUnique({ where: { idempotencyKey } });
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new ConflictException({ code: "tag_idempotency_conflict" });
        return receipt.result as { tagIds: string[]; version: number };
      }
      const existing = await tx.crmLeadTag.findMany({ where: { leadId, active: true } });
      for (const id of tagIds) {
        const tag = await this.get(tx, id); const tagContext = await this.context(tx, tag);
        if (tag.kind !== "TAG" || tag.scope === "CAMPUS" && !tagContext.campusKeys.some((key) => context.campusKeys.includes(key))) unknownReference("tags");
        if (tag.state !== "ACTIVE" && !existing.some((item) => item.tagId === id)) unknownReference("tags");
      }
      const changed = await tx.lead.updateMany({ where: { id: leadId, version: input.expectedVersion }, data: { version: { increment: 1 } } });
      if (changed.count !== 1) throw new ConflictException({ code: "lead_version_conflict" });
      await tx.crmLeadTag.updateMany({ where: { leadId, active: true, tagId: { notIn: tagIds } }, data: { active: false } });
      for (const tagId of tagIds) await tx.crmLeadTag.upsert({ where: { leadId_tagId: { leadId, tagId } }, create: { leadId, tagId }, update: { active: true } });
      const result = { tagIds, version: input.expectedVersion + 1 };
      await tx.leadActivity.create({ data: { leadId, type: "TAGS_CHANGED", result: "TAGS_CHANGED", authorId: principal.userId, correlationId, idempotencyKey } });
      await this.audit(tx, "LEAD_TAGS_CHANGED", leadId, principal, correlationId, { tagIds, version: result.version }, { tagIds: existing.map((row) => row.tagId), version: input.expectedVersion });
      await tx.leadMutationReceipt.create({ data: { leadId, operation: "TAGS_CHANGED", idempotencyKey, fingerprint, result } });
      return result;
    });
  }

  /** Explicit, audited inventory. No startup mutation and no lead UPDATE. */
  async captureLegacy(principal: Principal, correlationId: string): Promise<{ created: number }> {
    await this.permissions.assertCan(principal, "settings.global.manage", { scope: "GLOBAL", campusKeys: [], active: true });
    return this.repository.transaction(async (tx) => {
      const rows = await tx.lead.findMany({ select: { campus: true, program: true, campaign: true }, distinct: ["campus", "program", "campaign"] });
      let created = 0;
      for (const row of rows) for (const [field, kind] of [["campus", "CAMPUS"], ["program", "PROGRAM"], ["campaign", "CAMPAIGN"]] as const) {
        const campus = await resolveReference(tx, "CAMPUS", row.campus);
        if (await resolveReference(tx, kind, row[field], campus?.id)) continue;
        const code = `LEGACY_${createHash("sha256").update(row[field]).digest("hex").slice(0, 40)}`;
        const exists = await tx.crmReference.findUnique({ where: { kind_scopeKey_code: { kind, scopeKey: "GLOBAL", code } } });
        if (!exists) { await tx.crmReference.create({ data: { kind, code, label: row[field], state: "LEGACY", scope: "GLOBAL", scopeKey: "GLOBAL" } }); created++; }
      }
      await this.audit(tx, "REFERENCE_LEGACY_INVENTORIED", randomUUID(), principal, correlationId, { created });
      return { created };
    });
  }

  private managePermission(kind: string): PermissionKey { return kind === "TAG" ? "lead.tags.manage" : "lead.references.manage"; }
  private async campaignInUse(tx: ReferenceTransaction, reference: CrmReference): Promise<boolean> {
    if (reference.kind !== "CAMPAIGN") return false;
    const keys = new Set((await tx.crmReferenceKey.findMany({ where: { referenceId: reference.id } })).map((row) => row.key));
    const values = await tx.lead.findMany({ select: { campaign: true }, distinct: ["campaign"] });
    return values.some((row) => keys.has(referenceKey(row.campaign)));
  }
  private hasCampus(principal: Principal, keys: string[]): boolean { return principal.scopes.some((scope) => scope.kind === "CAMPUS" && keys.includes(scope.id)); }
  private async usedByLead(tx: ReferenceTransaction, row: CrmReference, leadId: string): Promise<boolean> {
    if (row.kind === "TAG") return (await tx.crmLeadTag.count({ where: { leadId, tagId: row.id, active: true } })) > 0;
    const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
    const raw = row.kind === "CAMPUS" ? lead.campus : row.kind === "PROGRAM" ? lead.program : row.kind === "CAMPAIGN" ? lead.campaign : undefined;
    if (!raw) return false;
    if (row.state === "LEGACY") return raw === row.label;
    return (await tx.crmReferenceKey.count({ where: { referenceId: row.id, key: referenceKey(raw) } })) > 0;
  }
  private async get(tx: ReferenceTransaction, id: string): Promise<CrmReference> {
    referenceId(id); const row = await tx.crmReference.findUnique({ where: { id } });
    if (!row) throw new NotFoundException({ code: "reference_not_found" }); return row;
  }
  private async campus(tx: ReferenceTransaction, id: string): Promise<CrmReference> {
    const campus = await this.get(tx, id); if (campus.kind !== "CAMPUS" || campus.state !== "ACTIVE") unknownReference("campus"); return campus;
  }
  private async campusKeys(tx: ReferenceTransaction, campus: CrmReference): Promise<string[]> {
    const aliases = await tx.crmReferenceKey.findMany({ where: { referenceId: campus.id } });
    return [campus.id, campus.code, campus.label, ...aliases.map((row) => row.key)];
  }
  private async definitionContext(tx: ReferenceTransaction, scope: string, campusId: string | null): Promise<ResourceContext> {
    return { scope: scope === "GLOBAL" ? "GLOBAL" : "CAMPUS", campusKeys: campusId ? await this.campusKeys(tx, await this.campus(tx, campusId)) : [], active: true };
  }
  private async context(tx: ReferenceTransaction, reference: CrmReference): Promise<ResourceContext> {
    return { scope: reference.scope === "GLOBAL" ? "GLOBAL" : "CAMPUS", campusKeys: reference.campusId ? await this.campusKeys(tx, await this.get(tx, reference.campusId)) : [], active: reference.state === "ACTIVE" };
  }
  private async leadContext(tx: ReferenceTransaction, id: string, principal: Principal): Promise<ResourceContext> {
    referenceId(id);
    const lead = await tx.lead.findUnique({ where: { id }, include: { collaborators: { where: { active: true } } } });
    if (!lead) throw new NotFoundException({ code: "lead_not_found" });
    const campus = await resolveReference(tx, "CAMPUS", lead.campus);
    const campusKeys = campus ? await this.campusKeys(tx, campus) : [lead.campus];
    const readable = principal.scopes.some((scope) => scope.kind === "GLOBAL" || scope.kind === "CAMPUS" && campusKeys.includes(scope.id));
    if (!readable) throw new NotFoundException({ code: "lead_not_found" });
    return { scope: "CAMPUS", campusKeys, active: true, ownerId: lead.assignedToId ?? "", collaboratorIds: lead.collaborators.map((row) => row.userId), readableResource: true };
  }
  private async keys(tx: ReferenceTransaction, row: CrmReference, values: string[]): Promise<void> {
    for (const key of new Set(values.map(referenceKey))) {
      const existing = await tx.crmReferenceKey.findUnique({ where: { kind_scopeKey_key: { kind: row.kind, scopeKey: row.scopeKey, key } } });
      if (existing && existing.referenceId !== row.id) throw new ConflictException({ code: "reference_canonical_conflict" });
      if (!existing) await tx.crmReferenceKey.create({ data: { referenceId: row.id, kind: row.kind, scopeKey: row.scopeKey, key, version: row.version } });
    }
  }
  private async audit(tx: ReferenceTransaction, eventType: string, id: string, principal: Principal, correlationId: string, after: Prisma.InputJsonObject, before?: Prisma.InputJsonObject): Promise<void> {
    await tx.auditEvent.create({ data: { eventType, actorId: principal.userId, actorRoles: principal.roles, correlationId: correlationId.slice(0, 64), result: "SUCCESS", idempotencyKey: `reference:${eventType}:${id}:${randomUUID()}`, after, ...(before ? { before } : {}) } });
  }
}
