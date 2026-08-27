import assert from "node:assert/strict";
import test from "node:test";
import { apiOrigin, MAX_BODY_BYTES, safePath } from "../app/api/crm/proxy-policy.js";
import { createProxy } from "../app/api/crm/[...path]/route.js";

function context(...path: string[]): { params: Promise<{ path: string[] }> } {
  return { params: Promise.resolve({ path }) };
}

function jsonRequest(path: string, method = "GET", body?: string): Request {
  return new Request(`http://web.local/api/crm/${path}?page=2`, { method, ...(body === undefined ? {} : { body }) });
}

function proxyWith(overrides: Partial<Parameters<typeof createProxy>[0]> = {}): ReturnType<typeof createProxy> {
  return createProxy({
    apiOrigin: () => "http://api:3001",
    fetch: () => Promise.resolve(Response.json({ ok: true })),
    getSession: () => Promise.resolve("synthetic-session"),
    production: false,
    randomId: () => "correlation-test",
    ...overrides,
  });
}

test("proxy policy accepts only bounded internal origins and safe relative segments", () => {
  assert.equal(apiOrigin({ CRM_API_INTERNAL_URL: "http://api:3001" }), "http://api:3001");
  assert.equal(safePath(["leads", "00000000-0000-4000-8000-000000000156", "timeline"]), "leads/00000000-0000-4000-8000-000000000156/timeline");
  assert.equal(MAX_BODY_BYTES, 1_048_576);
});

test("proxy policy fails closed for external or traversal-shaped inputs", () => {
  for (const environment of [{ NODE_ENV: "test" }, { NODE_ENV: "development" }, { NODE_ENV: "production" }, { CRM_API_INTERNAL_URL: "https://api.example.test/path" }, { CRM_API_INTERNAL_URL: "file:///tmp/api" }]) {
    assert.throws(() => apiOrigin(environment), /crm_api_internal_url_invalid/u);
  }
  for (const parts of [[], [".."], ["."], ["leads/secret"], ["\\absolute"], ["bad\0path"]]) {
    assert.throws(() => safePath(parts), /crm_api_path_invalid/u);
  }
});

test("proxy refuses unauthenticated reads without contacting the API", async () => {
  let contacted = false;
  const proxy = proxyWith({ getSession: () => Promise.resolve(undefined), fetch: () => { contacted = true; return Promise.resolve(Response.json({})); } });
  const response = await proxy(jsonRequest("leads"), context("leads"));
  assert.equal(response.status, 401);
  assert.equal(contacted, false);
  assert.deepEqual(await response.json(), { code: "authentication_required" });
});

test("proxy forwards a bounded authenticated mutation and strips upstream tokens", async () => {
  let observedUrl = "";
  let observedInit: RequestInit | undefined;
  const proxy = proxyWith({ fetch: (input, init) => {
    assert.ok(input instanceof URL); observedUrl = input.href; observedInit = init;
    return Promise.resolve(Response.json({ id: "lead-synthetic", token: "must-not-leak" }, { status: 201 }));
  } });
  const response = await proxy(jsonRequest("leads", "POST", JSON.stringify({ firstName: "Synthétique" })), context("leads"));
  assert.equal(response.status, 201);
  assert.equal(observedUrl, "http://api:3001/leads?page=2");
  assert.equal(new Headers(observedInit?.headers).get("authorization"), "Bearer synthetic-session");
  assert.equal(new Headers(observedInit?.headers).get("x-correlation-id"), "correlation-test");
  assert.deepEqual(await response.json(), { id: "lead-synthetic" });
});

test("proxy stores a successful login token only in a secure server cookie", async () => {
  const proxy = proxyWith({
    getSession: () => Promise.resolve(undefined),
    production: true,
    fetch: () => Promise.resolve(Response.json({ sessionId: "session-synthetic", token: "synthetic-token" })),
  });
  const response = await proxy(jsonRequest("sessions", "POST", "{}"), context("sessions"));
  assert.deepEqual(await response.json(), { sessionId: "session-synthetic" });
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, /crm_session=synthetic-token/u);
  assert.match(cookie, /HttpOnly/u);
  assert.match(cookie, /SameSite=strict/iu);
  assert.match(cookie, /Secure/u);
});

test("proxy fails closed for oversized bodies, invalid API JSON and upstream errors", async () => {
  const oversized = await proxyWith()(jsonRequest("leads", "POST", "x".repeat(MAX_BODY_BYTES + 1)), context("leads"));
  assert.equal(oversized.status, 413);
  const invalidJson = await proxyWith({ fetch: () => Promise.resolve(new Response("not-json", { status: 502 })) })(jsonRequest("leads"), context("leads"));
  assert.equal(invalidJson.status, 502);
  assert.deepEqual(await invalidJson.json(), { code: "invalid_api_response" });
  const unavailable = await proxyWith({ apiOrigin: () => { throw new Error("unavailable"); } })(jsonRequest("leads"), context("leads"));
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { code: "api_proxy_unavailable" });
});
