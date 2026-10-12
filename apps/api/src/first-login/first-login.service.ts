import { ForbiddenException, Inject, Injectable, Optional } from "@nestjs/common";
import { LocalCredentialAdapter } from "../access-recovery/access-recovery.store.js";
import { AuditService } from "../audit/audit.service.js";
import { SessionService } from "../auth/session.service.js";
import { UserService } from "../users/user.service.js";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { deriveSecret } from "../access-recovery/access-recovery.store.js";
import { PrismaService } from "../persistence/prisma.service.js";

function isAcceptableSecret(secret: string): boolean {
  return secret.length >= 14 && secret.length <= 128 && /[a-z]/.test(secret) && /[A-Z]/.test(secret) && /[0-9]/.test(secret) && /[^a-zA-Z0-9]/.test(secret) && !/\s/.test(secret);
}

@Injectable()
export class FirstLoginService {
  constructor(
    @Inject(LocalCredentialAdapter) private readonly credentials: LocalCredentialAdapter,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Optional() @Inject(UserService) private readonly users?: UserService,
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService,
  ) {}

  change(userId: string, currentSecret: string, nextSecret: string, correlationId: string): { revokedSessions: number } {
    if (!isAcceptableSecret(nextSecret) || currentSecret === nextSecret) throw new ForbiddenException({ code: "secret_policy_refused" });
    if (!this.credentials.replaceRequired(userId, currentSecret, nextSecret)) throw new ForbiddenException({ code: "temporary_credential_invalid" });
    this.users?.completeFirstLogin(userId);
    const revokedSessions = this.sessions.revokeUser(userId);
    this.audit.record({ eventType: "FIRST_LOGIN_SECRET_CHANGED", actorId: userId, actorRoles: [], correlationId, after: { subjectId: userId, revokedSessions }, result: "SUCCESS", idempotencyKey: `first-login-secret:${userId}:${correlationId}` });
    return { revokedSessions };
  }

  async flush(): Promise<void> {
    await Promise.all([this.credentials.flush(), this.users?.flush(), this.sessions.flush()]);
  }

  /** PostgreSQL is authoritative: no queued writes or cache mutation before commit. */
  async changeForApi(userId: string, currentSecret: string, nextSecret: string, correlationId: string, sessionId: string): Promise<{ revokedSessions: number }> {
    const client = this.prisma?.client;
    if (!client) {
      const result = this.change(userId, currentSecret, nextSecret, correlationId);
      await this.flush();
      return result;
    }
    if (!isAcceptableSecret(nextSecret) || currentSecret === nextSecret || currentSecret.length > 128) throw new ForbiddenException({ code: "secret_policy_refused" });
    return client.$transaction(async (tx) => {
      // Serialize against activation/authorization changes for this identity.
      await tx.$queryRaw`SELECT id FROM collaborators WHERE id = ${userId}::uuid FOR UPDATE`;
      const user = await tx.collaborator.findUnique({ where: { id: userId }, include: { passwordHash: true } });
      const session = await tx.localSession.findUnique({ where: { id: sessionId } });
      const credential = user?.passwordHash;
      if (!user?.active || !user.firstLoginRequired || !credential?.mustChange || !session?.active || session.collaboratorId !== userId || session.expiresAt <= new Date() || session.authenticationVersion !== user.authenticationVersion) throw new ForbiddenException({ code: "temporary_credential_invalid" });
      const expected = Buffer.from(credential.passwordDigest, "hex");
      const actual = Buffer.from(deriveSecret(currentSecret, credential.passwordSalt), "hex");
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new ForbiddenException({ code: "temporary_credential_invalid" });
      const salt = randomBytes(16).toString("hex");
      await tx.localPasswordHash.update({ where: { collaboratorId: userId }, data: { passwordSalt: salt, passwordDigest: deriveSecret(nextSecret, salt), mustChange: false } });
      await tx.collaborator.update({ where: { id: userId }, data: { firstLoginRequired: false, authenticationVersion: { increment: 1 } } });
      const revoked = await tx.localSession.updateMany({ where: { collaboratorId: userId, active: true }, data: { active: false, revokedAt: new Date() } });
      await tx.localAccessInvitation.updateMany({ where: { collaboratorId: userId, state: { in: ["PENDING", "SENT", "SEND_UNCONFIRMED"] } }, data: { state: "REVOKED" } });
      await tx.auditEvent.create({ data: {
        eventType: "FIRST_LOGIN_SECRET_CHANGED", actorId: userId, actorRoles: user.roles,
        campusId: user.campusId, resourceType: "COLLABORATOR", resourceId: userId,
        sessionId, correlationId, result: "SUCCESS",
        idempotencyKey: `first-login-secret:${userId}:v${user.authenticationVersion}`,
        after: { subjectId: userId, revokedSessions: revoked.count, authenticationVersion: user.authenticationVersion + 1 },
      } });
      return { revokedSessions: revoked.count };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
