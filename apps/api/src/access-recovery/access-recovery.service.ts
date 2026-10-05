import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import { RateLimitService } from "../auth/rate-limit.service.js";
import {
  digestRecoveryValue,
  LocalCredentialAdapter,
  LocalIdentityDirectory,
  LocalRecoveryChallengeStore,
  deriveSecret,
} from "./access-recovery.store.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { DynamicPermissionRepository } from "../permissions/dynamic-repository.js";
import { GmailInvitationSender } from "../invitations/gmail-invitation.sender.js";

export const RECOVERY_ACCEPTED = Object.freeze({
  accepted: true,
  message: "If the account is eligible, recovery instructions will be provided.",
});

const ALLOWED_RETURN_PATHS = new Set(["/access-recovery/complete"]);
export const RECOVERY_ACKNOWLEDGEMENT_MS = 15_000;
const RECOVERY_LIFETIME_MS = 15 * 60_000;
const ATTEMPT_WINDOW_MS = 60_000;
const ATTEMPT_LIMIT = 5;
const SUBJECT_LIMIT_PER_HOUR = 3;
export type RecoveryOperation = "REQUEST" | "COMPLETION";
const requestAuditKey = (challengeId: string): string => `access-recovery-requested:${challengeId}`;
function assertRecoveryEnabled(): void {
  if (process.env.CRM_ACCESS_RECOVERY_ENABLED !== "true") throw new ServiceUnavailableException({ code: "recovery_disabled" });
}
function invalidChallenge(): never { throw new ForbiddenException({ code: "recovery_challenge_invalid" }); }
function acceptableSecret(value: string): boolean {
  return value.length >= 14 && value.length <= 128 && /[a-z]/.test(value) && /[A-Z]/.test(value)
    && /[0-9]/.test(value) && /[^a-zA-Z0-9]/.test(value) && !/\s/.test(value);
}

function normalizedEmail(value: unknown): string {
  if (typeof value !== "string") throw new BadRequestException({ code: "recovery_request_invalid" });
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException({ code: "recovery_request_invalid" });
  }
  return email;
}

function allowedReturnPath(value: unknown): string {
  if (typeof value !== "string") throw new BadRequestException({ code: "recovery_return_path_invalid" });
  const path = value;
  if (!ALLOWED_RETURN_PATHS.has(path)) throw new BadRequestException({ code: "recovery_return_path_invalid" });
  return path;
}

@Injectable()
export class AccessRecoveryService {
  constructor(
    @Inject(LocalIdentityDirectory) private readonly identities: LocalIdentityDirectory,
    @Inject(LocalRecoveryChallengeStore) private readonly challenges: LocalRecoveryChallengeStore,
    @Inject(LocalCredentialAdapter) private readonly credentials: LocalCredentialAdapter,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService,
    @Optional() @Inject(DynamicPermissionRepository) private readonly permissions?: DynamicPermissionRepository,
    @Optional() @Inject(GmailInvitationSender) private readonly sender?: GmailInvitationSender,
  ) {}

  /** Committed by the HTTP guard before the completion's outer business fence.
   * Rejected completions therefore cannot roll back their rate-limit attempt. */
  async assertClientAllowedForApi(operation: RecoveryOperation, clientKey: string, now = Date.now()): Promise<void> {
    assertRecoveryEnabled();
    const permissions = this.requiredPermissions();
    const clientDigest = digestRecoveryValue(`crmy161-access-recovery-client:${clientKey}`);
    const eventType = `ACCESS_RECOVERY_${operation}_ATTEMPT`;
    await permissions.transaction(async (tx) => {
      const attempts = await tx.auditEvent.count({ where: {
        eventType, resourceType: "ACCESS_RECOVERY_CLIENT", resourceId: clientDigest,
        occurredAt: { gt: new Date(now - ATTEMPT_WINDOW_MS) },
      } });
      if (attempts >= ATTEMPT_LIMIT) throw new HttpException({ code: "rate_limit_exceeded" }, HttpStatus.TOO_MANY_REQUESTS);
      const attemptId = randomUUID();
      await tx.auditEvent.create({ data: {
        eventType, resourceType: "ACCESS_RECOVERY_CLIENT", resourceId: clientDigest,
        actorRoles: [], correlationId: attemptId, result: "SUCCESS", occurredAt: new Date(now),
        idempotencyKey: `access-recovery-attempt:${operation.toLowerCase()}:${attemptId}`, after: { operation },
      } });
    });
  }

  async requestForApi(emailValue: unknown, returnPathValue: unknown): Promise<typeof RECOVERY_ACCEPTED> {
    // An API-first rollout cannot emit a link until the compatible Web is ready.
    assertRecoveryEnabled();
    const startedAt = Date.now(), deadline = startedAt + RECOVERY_ACKNOWLEDGEMENT_MS;
    try {
      const email = normalizedEmail(emailValue), returnPath = allowedReturnPath(returnPathValue);
      const permissions = this.requiredPermissions();
      if (!this.sender?.configured()) throw new ServiceUnavailableException({ code: "recovery_transport_unavailable" });
      let origin: string;
      try { origin = this.sender.publicOrigin(); } catch { throw new ServiceUnavailableException({ code: "recovery_transport_unavailable" }); }
      const rawToken = randomBytes(32).toString("base64url"), tokenDigest = digestRecoveryValue(rawToken), now = new Date();
      const issued = await permissions.transaction(async (tx) => {
        const user = await tx.collaborator.findUnique({ where: { professionalEmail: email }, include: { passwordHash: true } });
        if (!user?.active || user.firstLoginRequired || !user.passwordHash || user.passwordHash.mustChange) return undefined;
        const recent = await tx.localRecoveryChallenge.count({ where: { collaboratorId: user.id, createdAt: { gt: new Date(now.getTime() - 3_600_000) } } });
        if (recent >= SUBJECT_LIMIT_PER_HOUR) return undefined; // Same public 202, not an account-existence signal.
        await tx.localRecoveryChallenge.updateMany({ where: { collaboratorId: user.id, usedAt: null }, data: { usedAt: now } });
        const challenge = await tx.localRecoveryChallenge.create({ data: { collaboratorId: user.id, tokenDigest, returnPath, expiresAt: new Date(now.getTime() + RECOVERY_LIFETIME_MS) } });
        await tx.auditEvent.create({ data: {
          eventType: "ACCESS_RECOVERY_REQUESTED", resourceType: "COLLABORATOR", resourceId: user.id,
          actorRoles: [], correlationId: challenge.id, result: "SUCCESS", idempotencyKey: requestAuditKey(challenge.id),
          after: { challengeId: challenge.id, authenticationVersion: user.authenticationVersion },
        } });
        return { id: challenge.id, recipient: user.professionalEmail };
      });
      if (issued) {
        // Gmail is outside the transaction. Fragment is not sent in HTTP/Referer.
        const remaining = Math.max(1, deadline - Date.now()), signal = AbortSignal.timeout(remaining);
        try {
          await this.sender.send({ recipient: issued.recipient, link: `${origin}${returnPath}#token=${encodeURIComponent(rawToken)}`, purpose: "RECOVERY", signal });
        } catch {
          // Do not retry or publicly distinguish delivery uncertainty from ineligible accounts.
          await permissions.transaction(async (tx) => {
            await tx.localRecoveryChallenge.updateMany({ where: { id: issued.id, usedAt: null }, data: { usedAt: new Date() } });
            await tx.auditEvent.create({ data: { eventType: "ACCESS_RECOVERY_DELIVERY_UNCONFIRMED", resourceType: "ACCESS_RECOVERY_CHALLENGE", resourceId: issued.id,
              actorRoles: [], correlationId: issued.id, result: "FAILED", idempotencyKey: `access-recovery-unconfirmed:${issued.id}`, after: { challengeId: issued.id } } });
          });
          return RECOVERY_ACCEPTED;
        }
      }
      return RECOVERY_ACCEPTED;
    } finally {
      // Common response window mitigates the obvious known-account Gmail latency branch.
      // This is not an absolute constant-time claim about PostgreSQL/network failures.
      await this.waitForAcknowledgement(deadline);
    }
  }

  async completeForApi(tokenValue: unknown, returnPathValue: unknown, nextSecretValue: unknown, now = Date.now()): Promise<void> {
    assertRecoveryEnabled();
    if (typeof tokenValue !== "string" || typeof nextSecretValue !== "string"
      || !/^[A-Za-z0-9_-]{40,128}$/.test(tokenValue) || !acceptableSecret(nextSecretValue)) {
      throw new BadRequestException({ code: "recovery_completion_invalid" });
    }
    const returnPath = allowedReturnPath(returnPathValue), permissions = this.requiredPermissions();
    await permissions.transaction(async (tx) => {
      const challenge = await tx.localRecoveryChallenge.findUnique({ where: { tokenDigest: digestRecoveryValue(tokenValue) } });
      if (!challenge || challenge.usedAt || challenge.expiresAt <= new Date(now) || challenge.returnPath !== returnPath) invalidChallenge();
      const issued = await tx.auditEvent.findUnique({ where: { idempotencyKey: requestAuditKey(challenge.id) } });
      const metadata = issued?.after;
      if (!issued || issued.eventType !== "ACCESS_RECOVERY_REQUESTED" || issued.resourceType !== "COLLABORATOR" || issued.resourceId !== challenge.collaboratorId
        || !metadata || typeof metadata !== "object" || Array.isArray(metadata) || metadata.challengeId !== challenge.id
        || typeof metadata.authenticationVersion !== "number" || !Number.isInteger(metadata.authenticationVersion) || metadata.authenticationVersion < 1) invalidChallenge();
      // No legacy token acceptance/backfill: the immutable request audit binds the issued version.
      const user = await tx.collaborator.findUnique({ where: { id: challenge.collaboratorId }, include: { passwordHash: true } });
      if (!user?.active || user.firstLoginRequired || !user.passwordHash || user.passwordHash.mustChange || user.authenticationVersion !== metadata.authenticationVersion) invalidChallenge();
      const usedAt = new Date(now);
      const claimed = await tx.localRecoveryChallenge.updateMany({ where: { id: challenge.id, collaboratorId: user.id, usedAt: null, returnPath, expiresAt: { gt: usedAt } }, data: { usedAt } });
      if (claimed.count !== 1) invalidChallenge();
      const versioned = await tx.collaborator.updateMany({ where: { id: user.id, active: true, firstLoginRequired: false, authenticationVersion: metadata.authenticationVersion }, data: { authenticationVersion: { increment: 1 } } });
      if (versioned.count !== 1) invalidChallenge();
      const salt = randomBytes(16).toString("hex");
      await tx.localPasswordHash.update({ where: { collaboratorId: user.id }, data: { identityDigest: digestRecoveryValue(user.professionalEmail), passwordSalt: salt, passwordDigest: deriveSecret(nextSecretValue, salt), mustChange: false } });
      const revoked = await tx.localSession.updateMany({ where: { collaboratorId: user.id, active: true }, data: { active: false, revokedAt: usedAt } });
      await tx.localRecoveryChallenge.updateMany({ where: { collaboratorId: user.id, usedAt: null }, data: { usedAt } });
      await tx.localAccessInvitation.updateMany({ where: { collaboratorId: user.id, state: { in: ["PENDING", "SENT", "SEND_UNCONFIRMED"] } }, data: { state: "REVOKED" } });
      await tx.auditEvent.create({ data: { eventType: "ACCESS_RECOVERY_COMPLETED", resourceType: "COLLABORATOR", resourceId: user.id, campusId: user.campusId,
        actorId: user.id, actorRoles: user.roles, correlationId: challenge.id, result: "SUCCESS", idempotencyKey: `access-recovery-completed:${challenge.id}`,
        after: { challengeId: challenge.id, authenticationVersion: user.authenticationVersion + 1, revokedSessions: revoked.count } } });
    });
  }

  protected async waitForAcknowledgement(deadline: number): Promise<void> {
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise<void>((resolve) => setTimeout(resolve, remaining));
  }

  private requiredPermissions(): DynamicPermissionRepository {
    if (!this.prisma?.client || !this.permissions) throw new ServiceUnavailableException({ code: "recovery_store_unavailable" });
    return this.permissions;
  }

  /** Historical explicit in-memory harness; HTTP never uses these adapters as authority. */
  request(emailValue: unknown, returnPathValue: unknown, requesterKey: string, now = Date.now()): typeof RECOVERY_ACCEPTED {
    this.rateLimit.assertAllowed(`access-recovery:${requesterKey}`, now, 5, 60_000);
    const email = normalizedEmail(emailValue);
    const returnPath = allowedReturnPath(returnPathValue);
    const identityDigest = digestRecoveryValue(email);

    const subjectId = this.identities.resolve(identityDigest);
    if (subjectId) {
      this.challenges.issue(subjectId, returnPath, now);
    } else {
      // Equal cryptographic work without retaining the submitted identifier.
      digestRecoveryValue(`${identityDigest}:${returnPath}`);
    }
    return RECOVERY_ACCEPTED;
  }

  complete(tokenValue: unknown, returnPathValue: unknown, nextSecretValue: unknown, now = Date.now()): void {
    if (typeof tokenValue !== "string" || typeof nextSecretValue !== "string") {
      throw new BadRequestException({ code: "recovery_completion_invalid" });
    }
    const token = tokenValue;
    const returnPath = allowedReturnPath(returnPathValue);
    const nextSecret = nextSecretValue;
    if (!/^[A-Za-z0-9_-]{40,128}$/.test(token) || nextSecret.length < 14 || nextSecret.length > 128) {
      throw new BadRequestException({ code: "recovery_completion_invalid" });
    }
    const subjectId = this.challenges.consume(token, returnPath, now);
    if (!subjectId) throw new ForbiddenException({ code: "recovery_challenge_invalid" });
    this.credentials.replace(subjectId, nextSecret);
  }

  async flush(): Promise<void> {
    await Promise.all([this.challenges.flush(), this.credentials.flush()]);
  }
}
