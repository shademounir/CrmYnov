import assert from "node:assert/strict";
import test from "node:test";
import { businessMailEvidence, canonicalMailRecipients, type MailRecipientSnapshot } from "../src/business-mail/business-mail-evidence.js";
import type { PreparedBusinessMail } from "../src/business-mail/business-mail-policy.js";

const message: PreparedBusinessMail = { type: "FOLLOW_UP_DUE", key: "a".repeat(64), templateVersion: "fr-v1", leadReference: "LD-SYNTHETIC",
  deadline: "2099-10-03T09:30:00Z", generatedAt: "2099-10-03T10:30:00Z", occurrence: 0, to: "owner@example.test", cc: ["copy@example.test"], recipientUserIds: ["synthetic-owner", "synthetic-copy"] };
const scope = { campusId: "synthetic-campus", campaignId: "synthetic-campaign" };
test("Immutable evidence binds generated content, ordered recipient addresses and exact scope without JSONB object ordering", () => {
  const evidence = businessMailEvidence(message, scope, "https://crm.example.test");
  assert.deepEqual(evidence.recipientSnapshots, [[1, "synthetic-owner", "owner@example.test", "TO", scope.campusId, scope.campaignId], [1, "synthetic-copy", "copy@example.test", "CC", scope.campusId, scope.campaignId]]);
  assert.equal(canonicalMailRecipients(JSON.parse(JSON.stringify(evidence.recipientSnapshots)) as MailRecipientSnapshot[]), JSON.stringify(evidence.recipientSnapshots));
  assert.match(evidence.fingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(businessMailEvidence(message, scope, "https://crm.example.test"), evidence);
  for (const changed of [{ ...message, to: "changed@example.test" }, { ...message, deadline: "2099-10-03T09:31:00Z" }, { ...message, leadReference: "LD-OTHER" }]) assert.notEqual(businessMailEvidence(changed, scope, "https://crm.example.test").fingerprint, evidence.fingerprint);
  assert.notEqual(businessMailEvidence(message, { ...scope, campaignId: "other" }, "https://crm.example.test").fingerprint, evidence.fingerprint);
});
test("Recipient evidence fails closed for malformed, ambiguous, injected or mixed-scope tuples", () => {
  const valid = businessMailEvidence(message, scope, "https://crm.example.test").recipientSnapshots;
  const invalid: unknown[] = [[], null, [valid[0], valid[0]], [[1, "owner", "bad\r\nBcc:x@example.test", "TO", "campus", null]],
    [[1, "owner", "owner@example.test", "CC", "campus", null]], [valid[0], [1, "other", "OWNER@example.test", "CC", scope.campusId, scope.campaignId]],
    [valid[0], [1, "other", "other@example.test", "CC", "foreign", scope.campaignId]], [[2, "owner", "owner@example.test", "TO", "campus", null]],
    [...valid, ...Array.from({ length: 100 }, () => valid[1])]];
  for (const rows of invalid) assert.throws(() => canonicalMailRecipients(rows as MailRecipientSnapshot[]), /recipient_evidence_invalid/);
  assert.throws(() => businessMailEvidence({ ...message, recipientUserIds: [] }, scope, "https://crm.example.test"));
});
