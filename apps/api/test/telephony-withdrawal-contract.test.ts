import assert from "node:assert/strict";
import test from "node:test";
import { parseWithdrawalRequest, isWithdrawalToken, withdrawalReceiptKey, parseWithdrawalReceipt } from "../src/telephony/telephony-withdrawal.contract.js";

const request = {
  requestId: "11111111-1111-4111-8111-111111111111",
  associationId: "22222222-2222-4222-8222-222222222222",
  workstationId: "33333333-3333-4333-8333-333333333333",
  profileId: "44444444-4444-4444-8444-444444444444",
};
const token = "synthetic_" + "a".repeat(64);
const receipt = { schemaVersion: 1, ...request, outcome: "WITHDRAWN", withdrawnAt: "2026-10-13T04:40:00.000Z", workstationVersion: 2, profileVersion: 3 };

test("withdrawal request accepts only the exact four UUID identities", () => {
  assert.deepEqual(parseWithdrawalRequest(request), request);
  for (const invalid of [null, undefined, [], "request", {}, { ...request, extra: true }, { ...request, schemaVersion: 1 }])
    assert.equal(parseWithdrawalRequest(invalid), null);
  for (const key of Object.keys(request)) {
    for (const invalid of [undefined, null, 42, "", "not-a-uuid", "00000000-0000-0000-0000-000000000000", " " + request.requestId])
      assert.equal(parseWithdrawalRequest({ ...request, [key]: invalid }), null, key);
  }
});

test("withdrawal credential validation refuses missing, short or oversized values", () => {
  assert.equal(isWithdrawalToken(token), true);
  for (const invalid of [undefined, null, 42, [], "", "short", "x".repeat(4096)]) assert.equal(isWithdrawalToken(invalid), false);
});

test("receipt commitment binds credential and every operation identity without exposing them", () => {
  const key = withdrawalReceiptKey(token, request);
  assert.equal(withdrawalReceiptKey(token, { ...request }), key);
  assert.equal(key.includes(token), false);
  for (const value of Object.values(request)) assert.equal(key.includes(value), false);
  assert.notEqual(withdrawalReceiptKey(token + "b", request), key);
  for (const field of Object.keys(request))
    assert.notEqual(withdrawalReceiptKey(token, { ...request, [field]: "55555555-5555-4555-8555-555555555555" }), key);
});

test("receipt is a versioned terminal proof of only the exact requested association", () => {
  assert.deepEqual(parseWithdrawalReceipt(receipt, request), receipt);
  for (const invalid of [null, [], {}, { ...receipt, schemaVersion: 2 }, { ...receipt, outcome: "PENDING" }, { ...receipt, outcome: "UNKNOWN" }, { ...receipt, outcome: "REVOKED" }])
    assert.equal(parseWithdrawalReceipt(invalid, request), null);
  for (const field of Object.keys(request))
    assert.equal(parseWithdrawalReceipt({ ...receipt, [field]: "55555555-5555-4555-8555-555555555555" }, request), null);
});

test("receipt versions and timestamp cannot manufacture a successful withdrawal", () => {
  for (const field of ["workstationVersion", "profileVersion"])
    for (const invalid of [0, -1, 1.5, "2", null, Number.NaN, Number.MAX_SAFE_INTEGER + 1])
      assert.equal(parseWithdrawalReceipt({ ...receipt, [field]: invalid }, request), null);
  for (const invalid of [null, "", "not-a-date", "2026-02-30T00:00:00.000Z"])
    assert.equal(parseWithdrawalReceipt({ ...receipt, withdrawnAt: invalid }, request), null);
});

test("receipt rejects credential-bearing or unrecognized fields", () => {
  for (const field of ["token", "tokenDigest", "sipPassword", "digest", "extra"])
    assert.equal(parseWithdrawalReceipt({ ...receipt, [field]: "synthetic-private-value" }, request), null);
});
