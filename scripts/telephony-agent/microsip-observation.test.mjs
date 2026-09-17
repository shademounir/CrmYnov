import assert from "node:assert/strict";
import test from "node:test";
import { applyMicroSipObservation, createObservedCall } from "./microsip-observation.mjs";

const base = {
  commandId: "11111111-1111-4111-8111-111111111111",
  callId: "22222222-2222-4222-8222-222222222222",
  workstationId: "sales-pc-01",
  phoneFingerprint: "a".repeat(64),
  requestedAt: "2026-09-16T10:00:00Z",
};
const observation = (observationId, type, occurredAt, overrides = {}) => ({
  observationId, type, occurredAt, workstationId: base.workstationId,
  phoneFingerprint: base.phoneFingerprint, ...overrides,
});

test("calculates only a local observed duration after CONNECTED then ENDED", () => {
  let call = createObservedCall(base);
  call = applyMicroSipObservation(call, observation("obs:connected:1", "CONNECTED", "2026-09-16T10:00:05Z"));
  call = applyMicroSipObservation(call, observation("obs:ended:0001", "ENDED", "2026-09-16T10:01:08Z"));
  assert.equal(call.state, "ENDED");
  assert.equal(call.durationSeconds, 63);
  assert.equal(call.reasonCode, "LOCAL_CALLBACK_DURATION");
});

test("does not turn an ambiguous end into a completed or missed call", () => {
  const call = applyMicroSipObservation(createObservedCall(base), observation("obs:ended:0002", "ENDED", "2026-09-16T10:00:12Z"));
  assert.equal(call.state, "UNCONFIRMED");
  assert.equal(call.durationSeconds, null);
  assert.equal(call.observations[0].decision, "REVIEW_REQUIRED");
});

test("replays one observation without a second business event", () => {
  const input = observation("obs:ringing:01", "RINGING", "2026-09-16T10:00:03Z");
  const replayed = applyMicroSipObservation(applyMicroSipObservation(createObservedCall(base), input), input);
  assert.equal(replayed.observations.length, 1);
  assert.equal(replayed.state, "RINGING");
});

test("quarantines a callback that cannot be correlated", () => {
  const call = applyMicroSipObservation(createObservedCall(base), observation("obs:ringing:02", "RINGING", "2026-09-16T10:00:03Z", { workstationId: "sales-pc-02" }));
  assert.equal(call.state, "REQUESTED");
  assert.equal(call.attemptObserved, false);
  assert.equal(call.observations[0].decision, "REVIEW_REQUIRED");
});

test("rejects conflicting callback reuse", () => {
  const once = applyMicroSipObservation(createObservedCall(base), observation("obs:event:0001", "RINGING", "2026-09-16T10:00:03Z"));
  assert.throws(() => applyMicroSipObservation(once, observation("obs:event:0001", "CONNECTED", "2026-09-16T10:00:05Z")), /observation_idempotency_conflict/);
});
