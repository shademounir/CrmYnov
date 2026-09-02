import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../persistence/prisma.service.js";

const allowedKeys = ["search", "assignedToId", "status", "source", "program", "campaign", "campus", "assignmentMode", "createdFrom", "createdTo", "sortBy", "sortDirection", "pageSize"] as const;
type FilterKey = typeof allowedKeys[number];
export type SavedLeadView = { id: string; name: string; filters: Partial<Record<FilterKey, string>>; version: number; createdAt: string; updatedAt: string };
export type SavedLeadViewInput = { name: string; filters: Record<string, unknown>; expectedVersion?: number };

@Injectable()
export class SavedLeadViewService {
  private readonly views = new Map<string, SavedLeadView & { ownerId: string }>();
  constructor(@Inject(AuditService) private readonly audit: AuditService, @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService) {}

  async list(principal: Principal): Promise<SavedLeadView[]> {
    if (!this.readAllowed(principal)) throw new ForbiddenException({ code: "saved_view_role_forbidden" });
    if (this.prisma?.client) return (await this.prisma.client.savedLeadView.findMany({ where: { ownerId: principal.userId }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }] })).map((row) => this.public(row));
    return [...this.views.values()].filter((view) => view.ownerId === principal.userId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)).map(({ ownerId: _ownerId, ...view }) => view);
  }

  async create(input: SavedLeadViewInput, principal: Principal, correlationId: string): Promise<SavedLeadView> {
    this.assertWrite(principal); const name = this.name(input.name); const filters = this.filters(input.filters, principal);
    if ((await this.list(principal)).length >= 25) throw new BadRequestException({ code: "saved_view_limit_reached" });
    if (this.prisma?.client) {
      try { const row = await this.prisma.client.$transaction((tx) => tx.savedLeadView.create({ data: { ownerId: principal.userId, name, filters } }), { isolationLevel: "Serializable" }); const result = this.public(row); this.audited("SAVED_LEAD_VIEW_CREATED", result, principal, correlationId); return result; }
      catch (error) { if (this.duplicate(error)) throw new ConflictException({ code: "saved_view_name_conflict" }); throw error; }
    }
    if ([...this.views.values()].some((view) => view.ownerId === principal.userId && view.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new ConflictException({ code: "saved_view_name_conflict" });
    const now = new Date().toISOString(); const result = { id: randomUUID(), ownerId: principal.userId, name, filters, version: 1, createdAt: now, updatedAt: now }; this.views.set(result.id, result); this.audited("SAVED_LEAD_VIEW_CREATED", result, principal, correlationId); return this.strip(result);
  }

  async update(id: string, input: SavedLeadViewInput, principal: Principal, correlationId: string): Promise<SavedLeadView> {
    this.assertWrite(principal); const current = await this.owned(id, principal); if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) throw new ConflictException({ code: "saved_view_version_conflict" });
    const name = this.name(input.name); const filters = this.filters(input.filters, principal);
    if (this.prisma?.client) {
      try { const row = await this.prisma.client.$transaction((tx) => tx.savedLeadView.update({ where: { id }, data: { name, filters, version: { increment: 1 } } }), { isolationLevel: "Serializable" }); const result = this.public(row); this.audited("SAVED_LEAD_VIEW_UPDATED", result, principal, correlationId); return result; }
      catch (error) { if (this.duplicate(error)) throw new ConflictException({ code: "saved_view_name_conflict" }); throw error; }
    }
    const next = { ...current, name, filters, version: current.version + 1, updatedAt: new Date().toISOString() }; this.views.set(id, next); this.audited("SAVED_LEAD_VIEW_UPDATED", next, principal, correlationId); return this.strip(next);
  }

  async remove(id: string, principal: Principal, correlationId: string): Promise<void> {
    this.assertWrite(principal); const current = await this.owned(id, principal); if (this.prisma?.client) await this.prisma.client.$transaction((tx) => tx.savedLeadView.delete({ where: { id } }), { isolationLevel: "Serializable" }); else this.views.delete(id); this.audited("SAVED_LEAD_VIEW_DELETED", current, principal, correlationId);
  }

  private async owned(id: string, principal: Principal): Promise<SavedLeadView & { ownerId: string }> {
    const view = this.prisma?.client ? await this.prisma.client.savedLeadView.findUnique({ where: { id } }).then((row) => row ? { ...this.public(row), ownerId: row.ownerId } : undefined) : this.views.get(id);
    if (!view) throw new NotFoundException({ code: "saved_view_not_found" }); if (view.ownerId !== principal.userId) throw new ForbiddenException({ code: "saved_view_owner_forbidden" }); return view;
  }
  private filters(value: Record<string, unknown>, principal: Principal): Partial<Record<FilterKey, string>> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException({ code: "saved_view_filters_invalid" });
    const entries = Object.entries(value); if (entries.some(([key, item]) => !allowedKeys.includes(key as FilterKey) || typeof item !== "string" || item.length > 120)) throw new BadRequestException({ code: "saved_view_filter_forbidden" });
    const filters = Object.fromEntries(entries.map(([key, item]) => [key, (item as string).trim()])) as Partial<Record<FilterKey, string>>;
    if (filters.campus && !principal.scopes.some((scope) => scope.kind === "GLOBAL" || (scope.kind === "CAMPUS" && scope.id === filters.campus))) throw new ForbiddenException({ code: "saved_view_campus_forbidden" });
    return filters;
  }
  private name(value: string): string { const name = value?.trim(); if (!name || name.length > 80 || !/^[\p{L}\p{N} .,'()_-]+$/u.test(name)) throw new BadRequestException({ code: "saved_view_name_invalid" }); return name; }
  private readAllowed(principal: Principal): boolean { return principal.roles.some((role) => ["ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN", "AUDITOR"].includes(role)); }
  private assertWrite(principal: Principal): void { if (!principal.roles.some((role) => ["ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN"].includes(role))) throw new ForbiddenException({ code: "saved_view_role_forbidden" }); }
  private public(row: { id: string; name: string; filters: unknown; version: number; createdAt: Date; updatedAt: Date }): SavedLeadView { return { id: row.id, name: row.name, filters: row.filters as Partial<Record<FilterKey, string>>, version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }; }
  private strip(view: SavedLeadView & { ownerId: string }): SavedLeadView { const { ownerId: _ownerId, ...result } = view; return result; }
  private duplicate(error: unknown): boolean { return (error as { code?: string }).code === "P2002"; }
  private audited(type: string, view: SavedLeadView, principal: Principal, correlationId: string): void { this.audit.record({ eventType: type, actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId, correlationId, result: "SUCCESS", idempotencyKey: `audit:${type}:${view.id}:${view.version}`, after: { viewId: view.id, name: view.name, filterKeys: Object.keys(view.filters) } }); }
}
