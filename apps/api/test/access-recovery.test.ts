import assert from "node:assert/strict";
import test from "node:test";
import { AccessRecoveryService, RECOVERY_ACCEPTED } from "../src/access-recovery/access-recovery.service.js";
import {
  digestRecoveryValue,
  LocalCredentialAdapter,
  LocalIdentityDirectory,
  LocalRecoveryChallengeStore,
} from "../src/access-recovery/access-recovery.store.js";
import { RateLimitService } from "../src/auth/rate-limit.service.js";
import type { HttpException } from "@nestjs/common";

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => {
    const response = (error as HttpException).getResponse?.();
    return typeof response === "object" && response !== null && "code" in response && response.code === code;
  };
}

function fixture(): {
  service: AccessRecoveryService;
  challenges: LocalRecoveryChallengeStore;
  credentials: LocalCredentialAdapter;
} {
  const challenges = new LocalRecoveryChallengeStore();
  const credentials = new LocalCredentialAdapter();
  return {
    service: new AccessRecoveryService(new LocalIdentityDirectory(), challenges, credentials, new RateLimitService()),
    challenges,
    credentials,
  };
}

test("returns an identical public result for known and unknown synthetic identities", () => {
  const { service } = fixture();
  const known = service.request("known-user@example.invalid", "/access-recovery/complete", "known-client", 1_000);
  const unknown = service.request("unknown-user@example.invalid", "/access-recovery/complete", "unknown-client", 1_000);
  assert.deepEqual(known, RECOVERY_ACCEPTED);
  assert.deepEqual(unknown, known);
  assert.deepEqual(Object.keys(known).sort(), ["accepted", "message"]);
});

test("stores only digests and consumes a valid challenge exactly once", () => {
  const { service, challenges, credentials } = fixture();
  const rawToken = challenges.issue(digestRecoveryValue("known-user@example.invalid"), "/access-recovery/complete", 2_000);
  const nextSecret = "synthetic-next-value-42";
  assert.equal(challenges.hasStoredRawToken(rawToken), false);
  service.complete(rawToken, "/access-recovery/complete", nextSecret, 2_001);
  assert.equal(credentials.hasStoredRawSecret(nextSecret), false);
  assert.throws(() => service.complete(rawToken, "/access-recovery/complete", nextSecret, 2_002), hasCode("recovery_challenge_invalid"));
});

test("refuses expired challenges and return-path substitution", () => {
  const { service, challenges } = fixture();
  const expired = challenges.issue(digestRecoveryValue("known-user@example.invalid"), "/access-recovery/complete", 3_000, 10);
  assert.throws(() => service.complete(expired, "/access-recovery/complete", "synthetic-next-value-42", 3_011), hasCode("recovery_challenge_invalid"));

  const redirected = challenges.issue(digestRecoveryValue("known-user@example.invalid"), "/access-recovery/complete", 4_000);
  assert.throws(() => service.complete(redirected, "https://outside.invalid/complete", "synthetic-next-value-42", 4_001), hasCode("recovery_return_path_invalid"));
});

test("rate limits repeated requests without echoing the submitted identity", () => {
  const { service } = fixture();
  for (let index = 0; index < 5; index += 1) {
    service.request(`unknown-${index}@example.invalid`, "/access-recovery/complete", "single-client", 5_000 + index);
  }
  assert.throws(
    () => service.request("unknown-last@example.invalid", "/access-recovery/complete", "single-client", 5_010),
    hasCode("rate_limit_exceeded"),
  );
});
