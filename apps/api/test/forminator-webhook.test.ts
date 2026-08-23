import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { AuditService } from "../src/audit/audit.service.js";
import { ForminatorWebhookController } from "../src/forminator-webhook/forminator-webhook.controller.js";
import { ForminatorWebhookService, canonicalizeForminatorPayload, type ForminatorLeadWebhook, type ForminatorWebhookHeaders } from "../src/forminator-webhook/forminator-webhook.service.js";

const syntheticSecret = "synthetic-only-webhook-secret-000000000001";
const now = Date.parse("2026-08-23T12:00:00Z");
const payload: ForminatorLeadWebhook = { schemaVersion: "1", eventId: "synthetic-event-0001", occurredAt: "2026-08-23T11:59:00Z",
  lead: { firstName: "Prénom", lastName: "Synthétique", email: "lead@example.invalid", educationLevel: "BAC", program: "Programme synthétique" } };

function headers(body: ForminatorLeadWebhook = payload, timestamp = String(Math.floor(now / 1000)), key = body.eventId): ForminatorWebhookHeaders {
  const signature = createHmac("sha256", syntheticSecret).update(`${timestamp}.${canonicalizeForminatorPayload(body)}`).digest("hex");
  return { timestamp, signature: `sha256=${signature}`, idempotencyKey: key };
}

function code(action: () => unknown): string {
  try { action(); return "missing_error"; } catch (error) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.() as { code?: string } | undefined;
    return response?.code ?? "unknown";
  }
}

test("accepts one synthetic signed event and replays it without mutation", () => {
  const service = new ForminatorWebhookService(syntheticSecret, true);
  const first = service.receive(headers(), payload, now); const replay = service.receive(headers(), payload, now);
  assert.equal(first.accepted, true); assert.equal(first.mutated, false); assert.equal(first.replayed, false); assert.equal(replay.replayed, true);
  const serialized = JSON.stringify(first); assert.equal(serialized.includes("lead@example.invalid"), false); assert.equal(serialized.includes(syntheticSecret), false);
});

test("refuses disabled, invalid, expired, conflicting and unknown-field events", () => {
  assert.equal(code(() => new ForminatorWebhookService("", false).receive(headers(), payload, now)), "forminator_webhook_disabled");
  const service = new ForminatorWebhookService(syntheticSecret, true);
  assert.equal(code(() => service.receive({ ...headers(), signature: `sha256=${"0".repeat(64)}` }, payload, now)), "forminator_signature_invalid");
  assert.equal(code(() => service.receive(headers(payload, String(Math.floor((now - 600_000) / 1000))), payload, now)), "forminator_timestamp_expired");
  assert.equal(code(() => service.receive(headers({ ...payload, lead: { ...payload.lead, unexpected: "refused" } } as ForminatorLeadWebhook),
    { ...payload, lead: { ...payload.lead, unexpected: "refused" } } as ForminatorLeadWebhook, now)), "forminator_unknown_field");
  service.receive(headers(), payload, now);
  const changed = { ...payload, lead: { ...payload.lead, program: "Autre programme synthétique" } };
  assert.equal(code(() => service.receive(headers(changed), changed, now)), "forminator_idempotency_conflict");
});

test("rate limits a bounded minute and controller audits only a digest", () => {
  const service = new ForminatorWebhookService(syntheticSecret, true);
  for (let index = 0; index < 60; index += 1) {
    const item = { ...payload, eventId: `synthetic-event-${String(index).padStart(4, "0")}` };
    service.receive(headers(item), item, now);
  }
  const overflow = { ...payload, eventId: "synthetic-event-overflow" };
  assert.equal(code(() => service.receive(headers(overflow), overflow, now)), "forminator_rate_limited");

  const audit = new AuditService(); const controller = new ForminatorWebhookController(new ForminatorWebhookService(syntheticSecret, true), audit);
  const current = Date.now(); const timestamp = String(Math.floor(current / 1000));
  const result = controller.receive(payload, timestamp, headers(payload, timestamp).signature, payload.eventId,
    { ip: "192.0.2.10", header: () => "synthetic-correlation" } as never);
  assert.equal(result.mutated, false); assert.equal(audit.list().length, 1);
  const serialized = JSON.stringify(audit.list());
  for (const forbidden of [syntheticSecret, "lead@example.invalid", "Prénom", "Synthétique"]) assert.equal(serialized.includes(forbidden), false);
});
