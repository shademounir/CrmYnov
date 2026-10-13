import assert from "node:assert/strict";
import test from "node:test";
import { agentApiPath, createAgentProxy } from "../app/agent/agent-proxy.js";

const prefix = ["integrations", "telephony", "agent", "v1"];
const context = (...path: string[]): { params: Promise<{ path: string[] }> } => ({ params: Promise.resolve({ path }) });

test("agent gateway exposes only the documented outbound agent POST surface", () => {
  for (const suffix of [["pair"], ["status"], ["poll"], ["events"], ["free-calls"], ["free-calls", "reconciliation"], ["profile-withdrawals"], ["profile-withdrawals", "receipt"], ["commands", "00000000-0000-4000-8000-000000000165", "claim"]]) {
    assert.equal(agentApiPath([...prefix, ...suffix]), [...prefix, ...suffix].join("/"));
  }
  for (const path of [[...prefix, "admin"], ["leads"], [...prefix, "commands", "invalid", "claim"], [...prefix, "free-calls", "reconciliation", "extra"], [...prefix, "free-calls", "resolve"], [...prefix, "profile-withdrawals", "delete"], [...prefix, "profile-withdrawals", "receipt", "extra"]]) {
    assert.throws(() => agentApiPath(path), /agent_api_path_forbidden/u);
  }
});

for (const suffix of [["profile-withdrawals"], ["profile-withdrawals", "receipt"]]) {
  test(`agent withdrawal gateway forwards only machine and service credentials: ${suffix.join("/")}`, async () => {
    let observed: RequestInit | undefined;
    let url = "";
    const receipt = { outcome: "WITHDRAWN", requestId: "synthetic-request" };
    const proxy = createAgentProxy({
      apiOrigin: () => "https://api.example.test",
      randomId: () => "withdrawal-correlation",
      getServiceAuthorization: () => Promise.resolve("Bearer synthetic-service-identity"),
      fetch: (input, init) => {
        url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        observed = init;
        return Promise.resolve(Response.json(receipt, { status: 201 }));
      },
    });
    const body = JSON.stringify({ requestId: "request", associationId: "generation", workstationId: "station", profileId: "profile" });
    const response = await proxy(new Request("https://web.example.test/agent/withdrawal", {
      method: "POST",
      headers: { cookie: "crm-session=synthetic", authorization: "Bearer browser-secret", "x-telephony-agent-token": "synthetic-machine-token" },
      body,
    }), context(...prefix, ...suffix));
    assert.equal(url, `https://api.example.test/${[...prefix, ...suffix].join("/")}`);
    assert.equal(observed?.method, "POST");
    assert.equal(observed?.cache, "no-store");
    assert.equal(observed?.redirect, "error");
    const headers = new Headers(observed?.headers);
    assert.equal(headers.get("cookie"), null);
    assert.equal(headers.get("authorization"), null);
    assert.equal(headers.get("x-telephony-agent-token"), "synthetic-machine-token");
    assert.equal(headers.get("x-serverless-authorization"), "Bearer synthetic-service-identity");
    assert.equal(new TextDecoder().decode(observed?.body as ArrayBuffer), body);
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), receipt);
  });
}

test("agent reconciliation gateway forwards only a machine credential, never a browser session", async () => {
  let observed: RequestInit | undefined;
  let url = "";
  const proxy = createAgentProxy({ apiOrigin: () => "https://api.example.test", randomId: () => "receipt-query", fetch: (input, init) => {
    url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url; observed = init;
    return Promise.resolve(Response.json({ outcome: "UNKNOWN" }));
  } });
  const body = JSON.stringify({ idempotencyKey: "free-synthetic-key" });
  const response = await proxy(new Request("https://web.example.test/agent/reconciliation", {
    method: "POST", headers: { cookie: "crm-session=synthetic", authorization: "Bearer browser-secret", "x-telephony-agent-token": "synthetic-machine-token" }, body,
  }), context(...prefix, "free-calls", "reconciliation"));
  assert.equal(response.status, 200);
  assert.equal(url, "https://api.example.test/integrations/telephony/agent/v1/free-calls/reconciliation");
  const headers = new Headers(observed?.headers);
  assert.equal(headers.get("cookie"), null);
  assert.equal(headers.get("authorization"), null);
  assert.equal(headers.get("x-telephony-agent-token"), "synthetic-machine-token");
  assert.equal(new TextDecoder().decode(observed?.body as ArrayBuffer), body);
  assert.equal(observed?.redirect, "error");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("agent gateway preserves its opaque token while using a distinct Cloud Run identity", async () => {
  let observedUrl = ""; let observedHeaders = new Headers();
  const proxy = createAgentProxy({
    apiOrigin: () => "https://api.example.test",
    getServiceAuthorization: () => Promise.resolve("Bearer google-id-token"),
    randomId: () => "agent-correlation",
    fetch: (input, init) => {
      observedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      observedHeaders = new Headers(init?.headers);
      return Promise.resolve(Response.json({ paired: true, token: "returned-once" }, { status: 201 }));
    },
  });
  const request = new Request("https://web.example.test/agent/integrations/telephony/agent/v1/pair", {
    method: "POST", headers: { "content-type": "application/json", "x-telephony-agent-token": "opaque-device-token" }, body: "{}",
  });
  const response = await proxy(request, context(...prefix, "pair"));
  assert.equal(response.status, 201);
  assert.equal(observedUrl, "https://api.example.test/integrations/telephony/agent/v1/pair");
  assert.equal(observedHeaders.get("x-telephony-agent-token"), "opaque-device-token");
  assert.equal(observedHeaders.get("x-serverless-authorization"), "Bearer google-id-token");
  assert.equal(observedHeaders.get("authorization"), null);
  assert.deepEqual(await response.json(), { paired: true, token: "returned-once" });
});

test("agent gateway rejects non-POST methods, oversized bodies and unknown paths", async () => {
  let contacted = false;
  const proxy = createAgentProxy({ apiOrigin: () => "http://api:3001", randomId: () => "id", fetch: () => { contacted = true; return Promise.resolve(Response.json({})); } });
  const get = await proxy(new Request("http://web/agent/x"), context(...prefix, "poll"));
  assert.equal(get.status, 405);
  const forbidden = await proxy(new Request("http://web/agent/x", { method: "POST", body: "{}" }), context("leads"));
  assert.equal(forbidden.status, 503);
  assert.equal(contacted, false);
});
