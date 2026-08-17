import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { LocalCredentialAdapter } from "../access-recovery/access-recovery.store.js";
import { AuditService } from "../audit/audit.service.js";
import { SessionService } from "../auth/session.service.js";

function isAcceptableSecret(secret: string): boolean {
  return secret.length >= 14 && /[a-z]/.test(secret) && /[A-Z]/.test(secret) && /[0-9]/.test(secret) && /[^a-zA-Z0-9]/.test(secret) && !/\s/.test(secret);
}

@Injectable()
export class FirstLoginService {
  constructor(
    @Inject(LocalCredentialAdapter) private readonly credentials: LocalCredentialAdapter,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  change(userId: string, currentSecret: string, nextSecret: string, correlationId: string): { revokedSessions: number } {
    if (!isAcceptableSecret(nextSecret) || currentSecret === nextSecret) throw new ForbiddenException({ code: "secret_policy_refused" });
    if (!this.credentials.replaceRequired(userId, currentSecret, nextSecret)) throw new ForbiddenException({ code: "temporary_credential_invalid" });
    const revokedSessions = this.sessions.revokeUser(userId);
    this.audit.record({ eventType: "FIRST_LOGIN_SECRET_CHANGED", actorId: userId, actorRoles: [], correlationId, after: { subjectId: userId, revokedSessions }, result: "SUCCESS", idempotencyKey: `first-login-secret:${userId}:${correlationId}` });
    return { revokedSessions };
  }
}
