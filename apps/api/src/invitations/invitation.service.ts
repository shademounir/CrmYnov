import { ConflictException, ForbiddenException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../persistence/prisma.service.js";
import { deriveSecret, digestRecoveryValue } from "../access-recovery/access-recovery.store.js";
import { GmailInvitationSender } from "./gmail-invitation.sender.js";
import type { Principal } from "../auth/auth.types.js";
import { DynamicPermissionRepository } from "../permissions/dynamic-repository.js";
import { currentPrincipal, campusContext, permissionDenied } from "../permissions/dynamic-context.js";
import { evaluatePermission } from "../permissions/dynamic-evaluator.js";
import { GLOBAL_CAMPUS } from "../permissions/dynamic-contract.js";

const LIFETIME_MS = 20 * 60_000;
const MAX_PER_HOUR = 3;
const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
const acceptable = (value: string): boolean => value.length >= 14 && value.length <= 128 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value) && /[^a-zA-Z0-9]/.test(value) && !/\s/.test(value);

@Injectable()
export class InvitationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(GmailInvitationSender) private readonly sender: GmailInvitationSender, @Inject(DynamicPermissionRepository) private readonly permissions: DynamicPermissionRepository) {}

  async issue(collaboratorId: string, actor: Principal): Promise<{ state: "ACCEPTED_BY_GMAIL" }> {
    const client = this.prisma.client;
    if (!client) throw new ServiceUnavailableException({ code: "invitation_database_unavailable" });
    if (!this.sender.configured()) throw new ServiceUnavailableException({ code: "invitation_transport_unconfigured" });
    const origin = this.sender.publicOrigin();
    const raw = randomBytes(32).toString("base64url");
    const now = new Date();
    const invitation = await this.permissions.transaction(async (tx) => {
      const current = await currentPrincipal(tx, actor);
      if (current.mustChangeSecret || !current.roles.includes("SUPER_ADMIN")) permissionDenied();
      const configurations = await this.permissions.snapshots(tx);
      if (!evaluatePermission(current, "users.roles.assign", configurations, campusContext(current, GLOBAL_CAMPUS)).allowed) permissionDenied();
      const user = await tx.collaborator.findUnique({ where: { id: collaboratorId } });
      if (!user?.active || !user.firstLoginRequired) throw new ForbiddenException({ code: "invitation_subject_ineligible" });
      const recent = await tx.localAccessInvitation.count({ where: { collaboratorId, createdAt: { gt: new Date(now.getTime() - 3_600_000) } } });
      if (recent >= MAX_PER_HOUR) throw new ConflictException({ code: "invitation_rate_limited" });
      await tx.localAccessInvitation.updateMany({ where: { collaboratorId, state: { in: ["PENDING", "SENT", "SEND_UNCONFIRMED"] } }, data: { state: "REVOKED" } });
      const created = await tx.localAccessInvitation.create({ data: { collaboratorId, linkDigest: digest(raw), state: "PENDING", expiresAt: new Date(now.getTime() + LIFETIME_MS) } });
      await tx.auditEvent.create({ data: { eventType: "ACCESS_INVITATION_REQUESTED", actorId: current.userId, actorRoles: current.roles, resourceType: "COLLABORATOR", resourceId: collaboratorId, correlationId: created.id, result: "SUCCESS", idempotencyKey: `access-invitation-requested:${created.id}`, after: { invitationId: created.id } } });
      return { id: created.id, recipient: user.professionalEmail };
    });
    // Fragments are not sent in HTTP requests, access logs or Referer headers.
    const link = `${origin}/invitation#code=${encodeURIComponent(raw)}`;
    try {
      await this.sender.send({ recipient: invitation.recipient, link });
    } catch {
      await client.localAccessInvitation.updateMany({ where: { id: invitation.id, state: "PENDING" }, data: { state: "SEND_UNCONFIRMED" } });
      throw new ServiceUnavailableException({ code: "invitation_delivery_unconfirmed" });
    }
    const activated = await client.localAccessInvitation.updateMany({ where: { id: invitation.id, state: "PENDING" }, data: { state: "SENT", sentAt: new Date() } });
    if (activated.count !== 1) throw new ConflictException({ code: "invitation_superseded" });
    return { state: "ACCEPTED_BY_GMAIL" };
  }

  async complete(raw: string, nextSecret: string): Promise<{ completed: true }> {
    if (!/^[A-Za-z0-9_-]{40,128}$/.test(raw) || !acceptable(nextSecret)) throw new ForbiddenException({ code: "invitation_input_invalid" });
    const client = this.prisma.client;
    if (!client) throw new ServiceUnavailableException({ code: "invitation_database_unavailable" });
    return client.$transaction(async (tx) => {
      const invitation = await tx.localAccessInvitation.findUnique({ where: { linkDigest: digest(raw) } });
      if (!invitation) throw new ForbiddenException({ code: "invitation_invalid" });
      if (invitation.state === "USED") throw new ConflictException({ code: "invitation_already_used" });
      if (invitation.state === "REVOKED") throw new ConflictException({ code: "invitation_revoked" });
      if (invitation.expiresAt <= new Date()) throw new ConflictException({ code: "invitation_expired" });
      if (invitation.state !== "SENT") throw new ConflictException({ code: "invitation_unavailable" });
      const user = await tx.collaborator.findUnique({ where: { id: invitation.collaboratorId } });
      if (!user?.active || !user.firstLoginRequired) throw new ForbiddenException({ code: "invitation_subject_ineligible" });
      const claimed = await tx.localAccessInvitation.updateMany({ where: { id: invitation.id, state: "SENT", expiresAt: { gt: new Date() } }, data: { state: "USED", usedAt: new Date() } });
      if (claimed.count !== 1) throw new ConflictException({ code: "invitation_already_used" });
      const salt = randomBytes(16).toString("hex");
      const identityDigest = digestRecoveryValue(user.professionalEmail);
      await tx.localPasswordHash.upsert({ where: { collaboratorId: user.id }, create: { collaboratorId: user.id, identityDigest, passwordSalt: salt, passwordDigest: deriveSecret(nextSecret, salt), mustChange: false }, update: { identityDigest, passwordSalt: salt, passwordDigest: deriveSecret(nextSecret, salt), mustChange: false } });
      await tx.collaborator.update({ where: { id: user.id }, data: { firstLoginRequired: false, authenticationVersion: { increment: 1 } } });
      await tx.localSession.updateMany({ where: { collaboratorId: user.id, active: true }, data: { active: false, revokedAt: new Date() } });
      await tx.auditEvent.create({ data: { eventType: "ACCESS_INVITATION_COMPLETED", actorId: user.id, actorRoles: user.roles, resourceType: "COLLABORATOR", resourceId: user.id, correlationId: invitation.id, result: "SUCCESS", idempotencyKey: `access-invitation-completed:${invitation.id}`, after: { invitationId: invitation.id } } });
      return { completed: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
