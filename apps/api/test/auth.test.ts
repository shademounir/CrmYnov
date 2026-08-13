import assert from "node:assert/strict";
import test from "node:test";
import { RateLimitService } from "../src/auth/rate-limit.service.js";
import { canAccessScope } from "../src/auth/rbac.guard.js";
import { SessionService } from "../src/auth/session.service.js";
import type { Principal } from "../src/auth/auth.types.js";

test("sessions authenticate until explicit user revocation", () => {
  const sessions = new SessionService();
  const created = sessions.create("synthetic-user", ["ADMISSIONS"], [{ kind: "CAMPUS", id: "campus-a" }]);
  assert.equal(sessions.authenticate(created.token)?.userId, "synthetic-user");
  assert.equal(sessions.revokeUser("synthetic-user"), 1);
  assert.equal(sessions.authenticate(created.token), undefined);
  assert.equal(sessions.revokeUser("synthetic-user"), 0);
});

test("expired and forged session tokens fail closed", () => {
  const sessions = new SessionService();
  const expired = sessions.create("synthetic-user", ["AUDITOR"], [{ kind: "GLOBAL" }], -1);
  assert.equal(sessions.authenticate(expired.token), undefined);
  assert.equal(sessions.authenticate("forged-token"), undefined);
});

test("scope checks prevent cross-campus IDOR", () => {
  const principal: Principal = { userId: "synthetic-user", roles: ["ADMISSIONS"], scopes: [{ kind: "CAMPUS", id: "campus-a" }], sessionId: "session-a" };
  assert.equal(canAccessScope(principal, { kind: "CAMPUS", id: "campus-a" }), true);
  assert.equal(canAccessScope(principal, { kind: "CAMPUS", id: "campus-b" }), false);
  assert.equal(canAccessScope(principal, { kind: "TEAM", id: "team-a" }), false);
});

test("rate limiting is deterministic and isolated per key", () => {
  const limiter = new RateLimitService();
  for (let index = 0; index < 2; index += 1) limiter.assertAllowed("client-a", 1_000, 2, 1_000);
  assert.throws(
    () => limiter.assertAllowed("client-a", 1_000, 2, 1_000),
    (error: unknown) => error instanceof Error && "getResponse" in error && JSON.stringify((error as { getResponse: () => unknown }).getResponse()).includes("rate_limit_exceeded"),
  );
  assert.doesNotThrow(() => limiter.assertAllowed("client-b", 1_000, 2, 1_000));
  assert.doesNotThrow(() => limiter.assertAllowed("client-a", 2_001, 2, 1_000));
});
