import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { ownAgentGatewayUrl, ownTelephonyError, ownTelephonyRequest, OwnTelephonyRequestError, parseOwnPairingCode, parseOwnTelephonySnapshot, type OwnTelephonySnapshot } from "../app/account/telephony/own-telephony-contract";

const snapshot: OwnTelephonySnapshot = {
  global: { enabled: true, mode: "LINPHONE" }, profile: { id: "profile-synthetic", extension: "synthetic-extension", enabled: true, state: "PAIRING_REQUIRED", version: 1 },
  workstation: null, readiness: { available: false, reason: "WORKSTATION_NOT_PAIRED" }, canPair: true, canRevoke: false,
  localPreferencesOnly: true, inboundEnabled: false, recordingEnabled: false,
};

test("agent address derives the public Web gateway with HTTPS or controlled loopback only", () => {
  assert.equal(ownAgentGatewayUrl("https://crm.example.invalid"), "https://crm.example.invalid/agent/");
  assert.equal(ownAgentGatewayUrl("http://127.0.0.1:3039"), "http://127.0.0.1:3039/agent/");
  assert.equal(ownAgentGatewayUrl("http://localhost:3039"), "http://localhost:3039/agent/");
  assert.equal(ownAgentGatewayUrl("http://[::1]:3039"), "http://[::1]:3039/agent/");
  for (const unsafe of ["http://crm.example.invalid", "file:///tmp/agent", "https://user:secret@crm.example.invalid", "https://crm.example.invalid?token=synthetic", "https://crm.example.invalid/#code=synthetic", "https://crm.example.invalid/api/private", "invalid"]) assert.equal(ownAgentGatewayUrl(unsafe), undefined);
});

test("personal telephony parser is a strict allowlist without shared SIP configuration or credentials", () => {
  assert.deepEqual(parseOwnTelephonySnapshot({ ...snapshot, secretReference: "PRIVATE-SYNTHETIC", token: "PRIVATE-SYNTHETIC", users: [{ id: "other-user" }], profile: { ...snapshot.profile, authUsername: "PRIVATE-SYNTHETIC" } }), snapshot);
  for (const invalid of [null, [], {}, { ...snapshot, global: null }, { ...snapshot, canPair: "true" }, { ...snapshot, localPreferencesOnly: false }, { ...snapshot, inboundEnabled: true }, { ...snapshot, recordingEnabled: true }, { ...snapshot, profile: { ...snapshot.profile, version: -1 } }, { ...snapshot, profile: { ...snapshot.profile, extension: "x".repeat(251) } }]) {
    assert.throws(() => parseOwnTelephonySnapshot(invalid));
  }
});

test("pairing credentials require a valid short-lived shape and are not returned with extra fields", () => {
  const pairing = { code: "SYNTHETIC_ONLY_CODE", profileId: "profile-synthetic", version: 2, expiresAt: "2099-01-01T10:00:00Z" };
  assert.deepEqual(parseOwnPairingCode({ ...pairing, token: "PRIVATE-SYNTHETIC" }, 0), pairing);
  for (const invalid of [{ ...pairing, code: "http://bad" }, { ...pairing, code: "short" }, { ...pairing, version: 1.5 }, { ...pairing, expiresAt: "invalid" }]) assert.throws(() => parseOwnPairingCode(invalid, 0));
  assert.throws(() => parseOwnPairingCode(pairing, Date.parse(pairing.expiresAt)));
});

test("personal request is same-origin, no-store and distinguishes session, permissions and uncertain writes", async () => {
  const request = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    assert.equal(input, "/api/crm/telephony/me"); assert.equal(init?.credentials, "same-origin"); assert.equal(init?.cache, "no-store");
    return Promise.resolve(Response.json(snapshot));
  }) as typeof fetch;
  assert.deepEqual(await ownTelephonyRequest("", undefined, request), snapshot);
  for (const [status, kind] of [[401, "session"], [403, "forbidden"], [503, "unavailable"]] as const) {
    await assert.rejects(ownTelephonyRequest("", undefined, (() => Promise.resolve(Response.json({ code: "PRIVATE raw failure" }, { status })))), (error: unknown) => error instanceof OwnTelephonyRequestError && error.kind === kind && error.code === "telephony_unavailable");
  }
  assert.match(ownTelephonyError(new OwnTelephonyRequestError("unavailable", "telephony_workstation_busy")).message, /commande est encore en cours/u);
  assert.match(ownTelephonyError(new OwnTelephonyRequestError("session", "ignored")).message, /session a expiré/u);
  assert.match(ownTelephonyError(new OwnTelephonyRequestError("forbidden", "ignored")).message, /permissions actuelles/u);
  assert.doesNotMatch(ownTelephonyError(new Error("PRIVATE-SYNTHETIC")).message, /PRIVATE/u);
});

test("personal telephony is included in first-login routing without changing the shared DEV API", async () => {
  const proxy = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");
  assert.match(proxy, /"\/account\/:path\*"/u);
  const own = (await Promise.all(["own-telephony.tsx", "own-telephony-view.tsx"].map((name) => readFile(new URL(`../app/account/telephony/${name}`, import.meta.url), "utf8")))).join("\n");
  assert.match(own, /href="crmynov-telephony:\/\/open"/u);
  assert.doesNotMatch(own, /localStorage|sessionStorage|console\.|tel:|\/telephony\/configuration|\/telephony\/provisioning/u);
});
