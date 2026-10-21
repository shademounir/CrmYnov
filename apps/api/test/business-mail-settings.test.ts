import assert from "node:assert/strict";
import test from "node:test";
import { parseBusinessMailSettings, type BusinessMailSettings } from "../src/business-mail/business-mail-settings.js";
import { parseMailOperatorRequest } from "../src/business-mail/business-mail-operator.js";
import { businessMailJobContract } from "../src/jobs/business-mail.js";
import { renderBusinessMailFixture } from "../src/business-mail/business-mail-template.js";
import type { PreparedBusinessMail } from "../src/business-mail/business-mail-policy.js";

const uuid = (n: number): string => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
export const syntheticMailSettings = (): BusinessMailSettings => ({ campusId: uuid(1), campaignIds: [uuid(2)], memberUserIds: [uuid(3)], warningCadenceHours: 24,
  maximumWarnings: 3, warningIntervalHours: 24, messagesPerHour: 10, messagesPerDay: 50, recipientsPerHour: 100, recipientsPerDay: 500 });
test("Mail settings are strict, finite and explicit, without implicit campus/campaign membership", () => {
  const valid = syntheticMailSettings(); assert.deepEqual(parseBusinessMailSettings(valid), valid);
  for (const changed of [null, {}, { ...valid, extra: true }, { ...valid, campaignIds: [] }, { ...valid, campaignIds: [uuid(2), uuid(2)] }, { ...valid, memberUserIds: ["not-uuid"] },
    { ...valid, warningCadenceHours: 0 }, { ...valid, warningIntervalHours: 23 }, { ...valid, messagesPerHour: 51 }, { ...valid, recipientsPerDay: 0 }, { ...valid, maximumWarnings: 31 }]) assert.throws(() => parseBusinessMailSettings(changed), /settings_invalid/);
});
test("Objective-bound operator rejects unknown keys, invented authority/session, stale version shapes and invalid mode", () => {
  const base = { mode: "PREPARE", authorizationSubjectId: uuid(3), operationId: uuid(4), expectedVersion: 0, sourceSha: "a".repeat(40), decisionSha256: "b".repeat(64), settings: syntheticMailSettings() };
  assert.deepEqual(parseMailOperatorRequest(base), base);
  for (const changed of [{ ...base, mode: "REPLAY_INVITATIONS" }, { ...base, sessionId: uuid(9) }, { ...base, authorizationSubjectId: "system:fake" }, { ...base, expectedVersion: -1 }, { ...base, sourceSha: "main" }]) assert.throws(() => parseMailOperatorRequest(changed));
  const { settings, ...operation } = base; assert.deepEqual(settings, syntheticMailSettings());
  assert.equal(parseMailOperatorRequest({ ...operation, mode: "ACTIVATE" }).mode, "ACTIVATE");
  assert.throws(() => parseMailOperatorRequest({ ...base, mode: "ACTIVATE" }), "Activation never accepts client settings/recipients");
});
test("Dedicated job is zero-I/O OFF and refuses unqualified, in-process or miswired launch", () => {
  assert.deepEqual(businessMailJobContract({}, "SEND"), { skipped: true });
  const env = { CRM_BUSINESS_MAIL_ENABLED: "true", CRM_BACKGROUND_WORKERS: "external", CRM_BUSINESS_MAIL_POLICY_QUALIFIED: "true", CRM_RUNTIME_DATABASE_NAME: "crmynov_stg",
    CRM_RUNTIME_DATABASE_ENVIRONMENT: "staging", CRM_RUNTIME_DATABASE_PROJECT: "crmynov-stg-n7x4q2", GOOGLE_CLOUD_PROJECT: "crmynov-stg-n7x4q2", CRM_BUSINESS_MAIL_SOURCE_SHA: "a".repeat(40) };
  assert.equal(businessMailJobContract(env, "SEND").skipped, false);
  for (const changed of [{ ...env, CRM_BACKGROUND_WORKERS: "in-process" }, { ...env, CRM_BUSINESS_MAIL_POLICY_QUALIFIED: "false" }, { ...env, GOOGLE_CLOUD_PROJECT: "foreign" }]) assert.throws(() => businessMailJobContract(changed, "SEND"));
  assert.throws(() => businessMailJobContract(env, "OPERATOR"));
  assert.equal(businessMailJobContract({ ...env, CRM_BUSINESS_MAIL_OPERATOR_QUALIFIED: "true", CRM_BUSINESS_MAIL_DELEGATION: "crm-ynov-po-delegation-20261001" }, "OPERATOR").skipped, false);
});
test("The qualification fixture is explicitly synthetic and never an invitation or prospect request", () => {
  const message: PreparedBusinessMail = { type: "FOLLOW_UP_DUE", key: "a".repeat(64), templateVersion: "fr-v1", leadReference: "LD-SYNTHETIC-TEST", deadline: "2099-01-01T00:00:00Z", generatedAt: "2099-01-01T00:00:00Z", occurrence: 0, to: "admin@example.test", cc: [], recipientUserIds: [uuid(3)] };
  const content = renderBusinessMailFixture(message, "https://crm.example.test");
  assert.match(content.subject, /^\[TEST TECHNIQUE INTERNE\]/); assert.match(content.text, /dossier synthétique inexistant/); assert.match(content.html, /ne prouve pas la réception ni la lecture/);
  assert.throws(() => renderBusinessMailFixture({ ...message, leadReference: "LD-REAL" }, "https://crm.example.test"));
  assert.throws(() => renderBusinessMailFixture({ ...message, cc: ["copy@example.test"] }, "https://crm.example.test"));
});
