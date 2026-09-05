import { ForbiddenException, HttpException, Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Prisma, SavedLeadView, SavedLeadViewShare } from "@prisma/client";
import type { Principal } from "../auth/auth.types.js";
import { DynamicPermissionRepository, type PermissionTransaction } from "../permissions/dynamic-repository.js";
import { currentPrincipal } from "../permissions/dynamic-context.js";
import { PermissionService, type ResourceContext } from "../permissions/permission.service.js";
import { canonicalCampus } from "../permissions/dynamic-resources.js";
import { professionalDisplayName } from "../users/professional-display-name.js";
import type { ViewDetails } from "./view-sharing.contract.js";
import { ViewSharingAudiences, mutatingRole, type ResolvedAudience } from "./view-sharing-audiences.js";
import { command, correlation, missingView, sharingInput, storedFilters, viewConflict, viewId, viewName, type Audience, type DuplicateViewInput, type ShareSummary, type SharingInput, type ViewCommand, type ViewSummary } from "./view-sharing.contract.js";

function denied(): never { throw new ForbiddenException({ code: "saved_view_permission_denied" }); }
function present(row: SavedLeadView, actor: Principal): ViewSummary { return { id: row.id, name: row.name, version: row.version, filters: storedFilters(row.filters), owned: row.ownerId === actor.userId }; }

@Injectable()
export class ViewSharingService {
  constructor(@Inject(DynamicPermissionRepository) private readonly repository: DynamicPermissionRepository,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(ViewSharingAudiences) private readonly audiences: ViewSharingAudiences) {}

  private unit<T>(actor: Principal, operation: (tx: PermissionTransaction, principal: Principal) => Promise<T>, mode: "read" | "write" = "write"): Promise<T> {
    return this.repository.transaction(async (tx) => operation(tx, await currentPrincipal(tx, actor)), mode);
  }

  availableAudiences(actor: Principal): Promise<Audience[]> { return this.unit(actor, (tx, principal) => this.audiences.list(tx, principal), "read"); }

  list(actor: Principal): Promise<ViewDetails[]> {
    return this.unit(actor, async (tx, principal) => {
      const rows = await tx.savedLeadView.findMany({ where: { archivedAt: null, shares: { some: { active: true } } }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }] });
      const result: ViewDetails[] = [];
      for (const row of rows) if (row.ownerId !== principal.userId && await this.readable(tx, row, principal)) result.push(await this.details(tx, row, principal));
      return result;
    }, "read");
  }

  read(id: string, actor: Principal): Promise<ViewDetails> {
    return this.unit(actor, async (tx, principal) => this.details(tx, await this.authorized(tx, id, principal), principal), "read");
  }

  /** Presentation is recomputed on authorized reads, never stored in mutation receipts. */
  private async details(tx: PermissionTransaction, view: SavedLeadView, principal: Principal): Promise<ViewDetails> {
    const isOwner = view.ownerId === principal.userId;
    const visible = await this.visibleAudiences(tx, view, principal);
    const canWritePrivate = mutatingRole(principal) && await this.permissions.can(principal, "lead.edit", await this.ownResource(tx, principal));
    return { ...present(view, principal), isOwner, ownerDisplayName: await this.ownerDisplayName(tx, view, principal),
      visibleAudiences: visible.audiences, canRevoke: visible.canRevoke,
      canEdit: isOwner && canWritePrivate,
      canDuplicate: canWritePrivate && await tx.savedLeadView.count({ where: { ownerId: principal.userId, archivedAt: null } }) < 25 };
  }

  private async visibleAudiences(tx: PermissionTransaction, view: SavedLeadView, principal: Principal): Promise<{ audiences: ViewDetails["visibleAudiences"]; canRevoke: boolean }> {
    const visible = new Map<string, ViewDetails["visibleAudiences"][number]>();
    let canRevoke = false;
    const shares = await tx.savedLeadViewShare.findMany({ where: { viewId: view.id, active: true }, orderBy: { id: "asc" } });
    for (const share of shares) {
      const audience = await this.accessibleAudience(tx, principal, share);
      if (!audience || !this.audienceParticipant(principal, audience, view.ownerId)) continue;
      if (!await this.permissions.can(principal, "lead.views.view", audience.resource)) continue;
      visible.set(`${audience.kind}:${audience.id}`, { type: audience.kind, label: audience.label });
      canRevoke ||= await this.audiences.canRevoke(principal, audience, view.ownerId);
    }
    return { audiences: [...visible.values()], canRevoke };
  }

  private audienceParticipant(principal: Principal, audience: ResolvedAudience, ownerId: string): boolean {
    return ownerId === principal.userId || audience.member || principal.roles.some((role) => role === "ADMIN" || role === "SUPER_ADMIN");
  }

  private async ownerDisplayName(tx: PermissionTransaction, view: SavedLeadView, principal: Principal): Promise<string> {
    const unavailable = "Utilisateur indisponible";
    const owner = await tx.collaborator.findUnique({ where: { id: view.ownerId }, select: { professionalDisplayName: true, active: true, campusId: true } });
    if (!owner?.active || !owner.professionalDisplayName || !owner.campusId) return unavailable;
    try {
      const campus = await canonicalCampus(tx, owner.campusId);
      const inCampus = principal.roles.includes("SUPER_ADMIN") || principal.scopes.some((scope) => scope.kind === "CAMPUS" && campus.keys.includes(scope.id));
      if (!inCampus || !await this.permissions.can(principal, "lead.views.view", { scope: "CAMPUS", campusKeys: campus.keys, active: true, ownerId: view.ownerId })) return unavailable;
      return professionalDisplayName(owner.professionalDisplayName) ?? unavailable;
    } catch (error) {
      if (error instanceof HttpException && [403, 404].includes(error.getStatus())) return unavailable;
      throw error;
    }
  }

  history(actor: Principal): Promise<ShareSummary[]> {
    return this.unit(actor, async (tx, principal) => {
      const rows = await tx.savedLeadViewShare.findMany({ include: { view: true }, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
      const result: ShareSummary[] = [];
      for (const share of rows) {
        const audience = await this.accessibleAudience(tx, principal, share);
        if (!audience) continue;
        const canRevoke = await this.audiences.canRevoke(principal, audience, share.view.ownerId);
        if (canRevoke || share.view.ownerId === principal.userId) result.push({ id: share.id, viewId: share.viewId, kind: share.kind,
          audienceId: audience.id, active: share.active && !share.view.archivedAt, version: share.version, viewVersion: share.view.version, canRevoke });
      }
      return result;
    }, "read");
  }

  share(id: string, input: SharingInput, actor: Principal, trace: string): Promise<ViewSummary> {
    sharingInput(input);
    return this.unit(actor, async (tx, principal) => {
      const view = await this.owned(tx, id, principal);
      const audience = await this.audiences.resolve(tx, principal, input.kind, input.audienceId);
      if (!await this.audiences.canShare(principal, audience)) denied();
      return this.mutation(tx, principal, `SHARE:${id}`, input, async () => {
        this.version(view, input);
        const audienceKey = `${input.kind}:${input.audienceId}`;
        const existing = await tx.savedLeadViewShare.findUnique({ where: { viewId_audienceKey: { viewId: view.id, audienceKey } } });
        if (existing?.active) viewConflict();
        const data = { kind: input.kind, campusId: audience.campusId, responsibilityId: input.kind === "TEAM" ? input.audienceId : null, active: true };
        if (existing) await tx.savedLeadViewShare.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } });
        else await tx.savedLeadViewShare.create({ data: { ...data, viewId: id, audienceKey } });
        const next = await this.bump(tx, view);
        await this.audit(tx, principal, next, "SAVED_LEAD_VIEW_SHARED", input, audience.campusId, trace);
        return present(next, principal);
      });
    });
  }

  revoke(shareId: string, input: ViewCommand, actor: Principal, trace: string): Promise<ViewSummary> {
    command(input); viewId(shareId);
    return this.unit(actor, async (tx, principal) => {
      const share = await tx.savedLeadViewShare.findUnique({ where: { id: shareId }, include: { view: true } });
      if (!share || share.view.archivedAt) missingView();
      const audience = await this.audiences.shareAudience(tx, principal, share);
      if (!await this.audiences.canRevoke(principal, audience, share.view.ownerId)) denied();
      return this.mutation(tx, principal, `REVOKE:${shareId}`, input, async () => {
        this.version(share.view, input); if (!share.active) viewConflict();
        await tx.savedLeadViewShare.update({ where: { id: share.id, version: share.version }, data: { active: false, version: { increment: 1 } } });
        const next = await this.bump(tx, share.view);
        await this.audit(tx, principal, next, "SAVED_LEAD_VIEW_REVOKED", input, audience.campusId, trace);
        // Administrative revocation must not disclose the owner's filter contents.
        return { id: next.id, name: "", filters: {}, version: next.version, owned: next.ownerId === principal.userId };
      });
    });
  }

  duplicate(id: string, input: DuplicateViewInput, actor: Principal, trace: string): Promise<ViewSummary> {
    command(input, ["name"]); const name = viewName(input.name);
    return this.unit(actor, async (tx, principal) => {
      const view = await this.authorized(tx, id, principal);
      await this.privateWrite(tx, principal);
      return this.mutation(tx, principal, `DUPLICATE:${id}`, input, async () => {
        this.version(view, input);
        if (await tx.savedLeadView.count({ where: { ownerId: principal.userId, archivedAt: null } }) >= 25) denied();
        const copy = await tx.savedLeadView.create({ data: { name, filters: storedFilters(view.filters), ownerId: principal.userId } });
        await this.audit(tx, principal, copy, "SAVED_LEAD_VIEW_DUPLICATED", input, await this.actorCampus(tx, principal), trace);
        return present(copy, principal);
      });
    });
  }

  archive(id: string, input: ViewCommand, actor: Principal, trace: string): Promise<ViewSummary> {
    command(input);
    return this.unit(actor, async (tx, principal) => {
      const view = await this.owned(tx, id, principal, true); await this.privateWrite(tx, principal);
      return this.mutation(tx, principal, `ARCHIVE:${id}`, input, async () => {
        this.version(view, input); if (view.archivedAt) missingView();
        const next = await tx.savedLeadView.update({ where: { id: view.id, version: view.version }, data: { archivedAt: new Date(), version: { increment: 1 } } });
        await this.audit(tx, principal, next, "SAVED_LEAD_VIEW_ARCHIVED", input, await this.actorCampus(tx, principal), trace);
        return present(next, principal);
      });
    });
  }

  private async actorCampus(tx: PermissionTransaction, principal: Principal): Promise<string | null> {
    const user = await tx.collaborator.findUniqueOrThrow({ where: { id: principal.userId } });
    if (!user.campusId) { if (principal.roles.includes("SUPER_ADMIN")) return null; denied(); }
    return (await canonicalCampus(tx, user.campusId)).id;
  }
  private async ownResource(tx: PermissionTransaction, principal: Principal): Promise<ResourceContext> {
    const campusId = await this.actorCampus(tx, principal);
    const keys = campusId ? (await canonicalCampus(tx, campusId)).keys : [];
    return { scope: campusId ? "CAMPUS" : "GLOBAL", campusKeys: keys, active: true, ownerId: principal.userId };
  }
  private async privateWrite(tx: PermissionTransaction, principal: Principal): Promise<void> {
    if (!mutatingRole(principal)) denied();
    await this.permissions.assertCan(principal, "lead.edit", await this.ownResource(tx, principal));
  }
  private async owned(tx: PermissionTransaction, id: string, principal: Principal, archived = false): Promise<SavedLeadView> {
    const view = await tx.savedLeadView.findUnique({ where: { id: viewId(id) } });
    if (!view || (view.archivedAt && !archived)) missingView(); if (view.ownerId !== principal.userId || !mutatingRole(principal)) denied(); return view;
  }
  private async authorized(tx: PermissionTransaction, id: string, principal: Principal): Promise<SavedLeadView> {
    const view = await tx.savedLeadView.findUnique({ where: { id: viewId(id) } });
    if (!view || view.archivedAt || !await this.readable(tx, view, principal)) missingView(); return view;
  }
  private async readable(tx: PermissionTransaction, view: SavedLeadView, principal: Principal): Promise<boolean> {
    if (view.ownerId === principal.userId) {
      return this.permissions.can(principal, "lead.view", await this.ownResource(tx, principal));
    }
    const shares = await tx.savedLeadViewShare.findMany({ where: { viewId: view.id, active: true } });
    for (const share of shares) {
      const audience = await this.accessibleAudience(tx, principal, share);
      if (!audience) continue;
      if ((audience.member || principal.roles.some((role) => role === "ADMIN" || role === "SUPER_ADMIN")) &&
        await this.permissions.can(principal, "lead.views.view", audience.resource)) return true;
    }
    return false;
  }
  private async accessibleAudience(tx: PermissionTransaction, principal: Principal, share: SavedLeadViewShare): Promise<ResolvedAudience | null> {
    try { return await this.audiences.shareAudience(tx, principal, share); }
    catch (error) { if (error instanceof HttpException && [403, 404].includes(error.getStatus())) return null; throw error; }
  }
  private version(view: SavedLeadView, input: ViewCommand): void { if (view.version !== input.expectedVersion) viewConflict(); }
  private bump(tx: PermissionTransaction, view: SavedLeadView): Promise<SavedLeadView> { return tx.savedLeadView.update({ where: { id: view.id, version: view.version }, data: { version: { increment: 1 } } }); }

  private async mutation(tx: PermissionTransaction, actor: Principal, action: string, input: ViewCommand, execute: () => Promise<ViewSummary>): Promise<ViewSummary> {
    const fingerprint = createHash("sha256").update(JSON.stringify([action, input])).digest("hex");
    const previous = await tx.savedViewMutation.findUnique({ where: { actorId_key: { actorId: actor.userId, key: input.idempotencyKey } } });
    if (previous) {
      if (previous.fingerprint !== fingerprint) viewConflict();
      const saved = previous.response;
      if (!saved || typeof saved !== "object" || Array.isArray(saved) || typeof saved.id !== "string" || typeof saved.name !== "string" || typeof saved.version !== "number" || typeof saved.owned !== "boolean") missingView();
      return { id: saved.id, name: saved.name, version: saved.version, owned: saved.owned, filters: storedFilters(saved.filters) };
    }
    const result = await execute();
    const response: Prisma.InputJsonObject = { ...result, filters: result.filters };
    await tx.savedViewMutation.create({ data: { actorId: actor.userId, key: input.idempotencyKey, fingerprint, response } });
    return result;
  }
  private async audit(tx: PermissionTransaction, actor: Principal, view: SavedLeadView, action: string, input: ViewCommand, campusId: string | null, trace: string): Promise<void> {
    await tx.auditEvent.create({ data: { actorId: actor.userId, actorRoles: [...actor.roles], campusId, resourceType: "SAVED_LEAD_VIEW", resourceId: view.id,
      eventType: action, result: "SUCCESS", correlationId: correlation(trace), idempotencyKey: `view:${actor.userId}:${input.idempotencyKey}`,
      before: { expectedVersion: input.expectedVersion }, after: { version: view.version, active: !view.archivedAt } } });
  }
}
