import { Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";

interface ChallengeRecord {
  identityDigest: string;
  returnPath: string;
  expiresAt: number;
  used: boolean;
}

export function digestRecoveryValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

@Injectable()
export class LocalRecoveryChallengeStore {
  private readonly challenges = new Map<string, ChallengeRecord>();

  issue(identityDigest: string, returnPath: string, now = Date.now(), lifetimeMs = 15 * 60_000): string {
    const rawToken = randomBytes(32).toString("base64url");
    this.challenges.set(digestRecoveryValue(rawToken), {
      identityDigest,
      returnPath,
      expiresAt: now + lifetimeMs,
      used: false,
    });
    return rawToken;
  }

  consume(rawToken: string, returnPath: string, now = Date.now()): string | undefined {
    const record = this.challenges.get(digestRecoveryValue(rawToken));
    if (!record || record.used || record.expiresAt <= now || record.returnPath !== returnPath) return undefined;
    record.used = true;
    return record.identityDigest;
  }

  hasStoredRawToken(rawToken: string): boolean {
    return JSON.stringify([...this.challenges.values()]).includes(rawToken);
  }
}

@Injectable()
export class LocalIdentityDirectory {
  private readonly knownIdentities = new Set([
    digestRecoveryValue("known-user@example.invalid"),
  ]);

  has(identityDigest: string): boolean {
    return this.knownIdentities.has(identityDigest);
  }
}

@Injectable()
export class LocalCredentialAdapter {
  private readonly credentialDigests = new Map<string, string>();

  replace(identityDigest: string, nextSecret: string): void {
    this.credentialDigests.set(identityDigest, digestRecoveryValue(nextSecret));
  }

  hasStoredRawSecret(rawSecret: string): boolean {
    return JSON.stringify([...this.credentialDigests.values()]).includes(rawSecret);
  }
}
