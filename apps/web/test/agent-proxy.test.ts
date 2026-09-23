import assert from "node:assert/strict";
import test from "node:test";
import { agentApiPath, createAgentProxy } from "../app/agent/agent-proxy.js";

const prefix = ["integrations", "telephony", "agent", "v1"];
const context = (...path: string[]): { params: Promise<{ path: string[] }> } => ({ params: Promise.resolve({ path }) });

test("agent gateway exposes only the documented outbound agent POST surface", () => {
  for (const suffix of [["pair"], ["status"], ["poll"], ["events"], ["free-calls"], ["commands", "00000000-0000-4000-8000-000000000165", "claim"]]) {
    assert.equal(agentApiPath([...prefix, ...suffix]), [...prefix, ...suffix].join("/"));
  }
  for (const path of [[...prefix, "admin"], ["leads"], [...prefix, "commands", "invalid", "claim"]]) {
    assert.throws(() => agentApiPath(path), /agent_api_path_forbidden/u);
  }
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
