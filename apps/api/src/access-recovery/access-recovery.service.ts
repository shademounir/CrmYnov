import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { RateLimitService } from "../auth/rate-limit.service.js";
import {
  digestRecoveryValue,
  LocalCredentialAdapter,
  LocalIdentityDirectory,
  LocalRecoveryChallengeStore,
} from "./access-recovery.store.js";

export const RECOVERY_ACCEPTED = Object.freeze({
  accepted: true,
  message: "If the account is eligible, recovery instructions will be provided.",
});

const ALLOWED_RETURN_PATHS = new Set(["/access-recovery/complete"]);

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
  ) {}

  request(emailValue: unknown, returnPathValue: unknown, requesterKey: string, now = Date.now()): typeof RECOVERY_ACCEPTED {
    this.rateLimit.assertAllowed(`access-recovery:${requesterKey}`, now, 5, 60_000);
    const email = normalizedEmail(emailValue);
    const returnPath = allowedReturnPath(returnPathValue);
    const identityDigest = digestRecoveryValue(email);

    if (this.identities.has(identityDigest)) {
      this.challenges.issue(identityDigest, returnPath, now);
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
    const identityDigest = this.challenges.consume(token, returnPath, now);
    if (!identityDigest) throw new ForbiddenException({ code: "recovery_challenge_invalid" });
    this.credentials.replace(identityDigest, nextSecret);
  }
}
