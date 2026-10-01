const terminalStates = new Set(["ENDED", "FAILED", "UNCONFIRMED"]);
const observationTypes = new Set(["OUTGOING", "RINGING", "BUSY", "CONNECTED", "ENDED", "CLIENT_EXITED"]);

function requireText(value, name, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) throw new TypeError(`${name}_invalid`);
  return value;
}

function instant(value, name) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${name}_invalid`);
  return new Date(parsed).toISOString();
}

/** Pure prototype: no raw destination and no MicroSIP process invocation. */
export function createObservedCall(input) {
  return {
    schemaVersion: "1",
    commandId: requireText(input.commandId, "command_id", /^[0-9a-f-]{36}$/i),
    callId: requireText(input.callId, "call_id", /^[0-9a-f-]{36}$/i),
    workstationId: requireText(input.workstationId, "workstation_id", /^[A-Za-z0-9_-]{8,64}$/),
    phoneFingerprint: requireText(input.phoneFingerprint, "phone_fingerprint", /^[0-9a-f]{64}$/i).toLowerCase(),
    requestedAt: instant(input.requestedAt, "requested_at"),
    state: "REQUESTED",
    attemptObserved: false,
    answeredAt: null,
    endedAt: null,
    durationSeconds: null,
    reasonCode: null,
    observations: [],
  };
}

/** Applies an observation without turning an ambiguous callback into proof. */
export function applyMicroSipObservation(current, input) {
  const next = structuredClone(current);
  const observation = {
    observationId: requireText(input.observationId, "observation_id", /^[A-Za-z0-9:_-]{8,160}$/),
    type: requireText(input.type, "observation_type", /^[A-Z_]+$/),
    occurredAt: instant(input.occurredAt, "occurred_at"),
    workstationId: requireText(input.workstationId, "workstation_id", /^[A-Za-z0-9_-]{8,64}$/),
    phoneFingerprint: requireText(input.phoneFingerprint, "phone_fingerprint", /^[0-9a-f]{64}$/i).toLowerCase(),
  };
  if (!observationTypes.has(observation.type)) throw new TypeError("observation_type_unsupported");

  const replay = next.observations.find((item) => item.observationId === observation.observationId);
  if (replay) {
    if (JSON.stringify(replay.input) !== JSON.stringify(observation)) throw new Error("observation_idempotency_conflict");
    return next;
  }

  if (observation.workstationId !== next.workstationId || observation.phoneFingerprint !== next.phoneFingerprint) {
    next.observations.push({ observationId: observation.observationId, input: observation, decision: "REVIEW_REQUIRED", reasonCode: "CORRELATION_MISMATCH" });
    return next;
  }
  if (terminalStates.has(next.state)) throw new Error("observation_after_terminal_state");
  if (Date.parse(observation.occurredAt) < Date.parse(next.requestedAt)) throw new Error("observation_out_of_order");

  let decision = "APPLIED";
  if (observation.type === "OUTGOING") {
    next.attemptObserved = true;
  } else if (observation.type === "RINGING") {
    next.attemptObserved = true;
    next.state = "RINGING";
  } else if (observation.type === "BUSY") {
    next.attemptObserved = true;
    next.state = "FAILED";
    next.endedAt = observation.occurredAt;
    next.reasonCode = "BUSY_LOCAL_CALLBACK";
  } else if (observation.type === "CONNECTED") {
    next.attemptObserved = true;
    next.state = "ANSWERED";
    next.answeredAt = observation.occurredAt;
  } else if (observation.type === "ENDED" && next.answeredAt) {
    next.state = "ENDED";
    next.endedAt = observation.occurredAt;
    next.durationSeconds = Math.max(0, Math.floor((Date.parse(next.endedAt) - Date.parse(next.answeredAt)) / 1000));
    next.reasonCode = "LOCAL_CALLBACK_DURATION";
  } else if (observation.type === "ENDED") {
    next.state = "UNCONFIRMED";
    next.endedAt = observation.occurredAt;
    next.reasonCode = "END_WITHOUT_CONNECTED_CALLBACK";
    decision = "REVIEW_REQUIRED";
  } else if (observation.type === "CLIENT_EXITED") {
    next.state = "UNCONFIRMED";
    next.endedAt = observation.occurredAt;
    next.reasonCode = "CLIENT_EXITED_WITHOUT_TERMINAL_CALLBACK";
    decision = "REVIEW_REQUIRED";
  }

  next.observations.push({ observationId: observation.observationId, input: observation, decision, reasonCode: next.reasonCode });
  return next;
}
