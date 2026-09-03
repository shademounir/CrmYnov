import { ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { PermissionService } from "../permissions/permission.service.js";
import { hasAuditRole } from "../permissions/audit-access.js";
import { auditView, type AuditView } from "./audit-view.js";
import { auditId, parseAuditQuery, type AuditQuery } from "./audit-query.js";
export interface AuditPage { items: AuditView[]; total: number; page: number; pageSize: number; snapshot: string; campuses: Array<{ id: string }>; global: boolean; timeZone: string }
interface Visibility { where: Prisma.AuditEventWhereInput; campuses: Array<{ id: string }>; global: boolean }

@Injectable()
export class AuditReader {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(PermissionService) private readonly permissions: PermissionService) {}
  private client(principal: Principal): PrismaClient {
    if (!hasAuditRole(principal)) throw new ForbiddenException({ code: "audit_role_forbidden" });
    if (!this.prisma.client) throw new ServiceUnavailableException({ code: "audit_store_unavailable" });
    return this.prisma.client;
  }
  private async visibility(client: PrismaClient, principal: Principal, selected?: string): Promise<Visibility> {
    const global = await this.permissions.can(principal, "audit.view", { scope: "GLOBAL", campusKeys: [], active: true });
    const campuses = await client.crmReference.findMany({ where: { kind: "CAMPUS" }, include: { keys: true }, orderBy: { id: "asc" } });
    const allowed: Array<{ id: string; keys: string[] }> = [];
    for (const row of campuses) {
      const keys = [...new Set([row.id, row.code, row.label, ...row.keys.map((item) => item.key)])];
      if (await this.permissions.can(principal, "audit.view", { scope: "CAMPUS", campusKeys: keys, active: true })) allowed.push({ id: row.id, keys });
    }
    if (!global && !allowed.length) throw new ForbiddenException({ code: "permission_denied" });
    const scoped = selected ? allowed.filter((item) => item.id === selected) : allowed;
    if (selected && !scoped.length) throw new ForbiddenException({ code: "permission_denied" });
    const clauses: Prisma.AuditEventWhereInput[] = [{ campusId: { in: scoped.flatMap((item) => item.keys) } }];
    // Legacy/unattributed evidence is GLOBAL-only; never infer its campus from today's actor.
    if (global && !selected) clauses.push({ campusId: null });
    return { where: { OR: clauses }, campuses: allowed.map((item) => ({ id: item.id })), global };
  }
  async list(raw: Record<string, unknown>, principal: Principal): Promise<AuditPage> {
    const query = parseAuditQuery(raw), client = this.client(principal);
    const visibility = await this.visibility(client, principal, query.campus);
    const where: Prisma.AuditEventWhereInput = { AND: [visibility.where, this.filters(query)] };
    const [rows, total] = await Promise.all([
      client.auditEvent.findMany({ where, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      client.auditEvent.count({ where }),
    ]);
    await this.recordRead(client, principal, "AUDIT_SEARCHED", query.campus ?? null, null, rows.length);
    return { items: rows.map(auditView), total, page: query.page, pageSize: query.pageSize, snapshot: query.snapshot.toISOString(), campuses: visibility.campuses, global: visibility.global, timeZone: "Africa/Casablanca" };
  }
  async detail(id: string, principal: Principal): Promise<AuditView> {
    auditId(id); const client = this.client(principal), visibility = await this.visibility(client, principal);
    const row = await client.auditEvent.findFirst({ where: { AND: [visibility.where, { id }] } });
    if (!row) throw new NotFoundException({ code: "audit_event_not_found" });
    await this.recordRead(client, principal, "AUDIT_VIEWED", row.campusId, row.id, 1);
    return auditView(row);
  }
  private filters(query: AuditQuery): Prisma.AuditEventWhereInput {
    const until = query.to && query.to < query.snapshot ? query.to : query.snapshot;
    return { occurredAt: { lte: until, ...(query.from ? { gte: query.from } : {}) },
      ...(query.actorId ? { actorId: query.actorId } : {}), ...(query.eventType ? { eventType: query.eventType } : {}),
      ...(query.resourceId ? { resourceId: query.resourceId } : {}), ...(query.resourceType ? { resourceType: query.resourceType } : {}), ...(query.result ? { result: query.result } : {}) };
  }
  private async recordRead(client: PrismaClient, principal: Principal, eventType: string, campusId: string | null, resourceId: string | null, count: number): Promise<void> {
    const requestId = randomUUID();
    await client.auditEvent.create({ data: { eventType, campusId, resourceType: "AUDIT", resourceId, actorId: principal.userId, actorRoles: [...principal.roles], correlationId: requestId, idempotencyKey: `audit-read:${requestId}`, result: "SUCCESS", after: { count } } });
  }
}
