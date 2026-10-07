import assert from "node:assert/strict";
import test from "node:test";
import { apiOrigin, MAX_BODY_BYTES, safePath } from "../app/api/crm/proxy-policy.js";
import { createProxy } from "../app/api/crm/proxy.js";

function context(...path: string[]): { params: Promise<{ path: string[] }> } {
  return { params: Promise.resolve({ path }) };
}

function jsonRequest(path: string, method = "GET", body?: string): Request {
  return new Request(`http://web.local/api/crm/${path}?page=2`, { method, headers: { origin: "https://web.example.test", "content-type": "application/json" }, ...(body === undefined ? {} : { body }) });
}

function proxyWith(overrides: Partial<Parameters<typeof createProxy>[0]> = {}): ReturnType<typeof createProxy> {
  return createProxy({
    apiOrigin: () => "http://api:3001",
    publicOrigin: () => "https://web.example.test",
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

test("proxy keeps application authorization separate from Cloud Run service identity", async () => {
  let observed = new Headers();
  const proxy = proxyWith({
    getServiceAuthorization: () => Promise.resolve("Bearer google-id-token"),
    fetch: (_input, init) => { observed = new Headers(init?.headers); return Promise.resolve(Response.json({ ok: true })); },
  });
  const response = await proxy(jsonRequest("leads"), context("leads"));
  assert.equal(response.status, 200);
  assert.equal(observed.get("authorization"), "Bearer synthetic-session");
  assert.equal(observed.get("x-serverless-authorization"), "Bearer google-id-token");
});

test("proxy stores a successful login token only in a secure server cookie", async () => {
  const proxy = proxyWith({
    getSession: () => Promise.resolve(undefined),
    production: true,
    fetch: () => Promise.resolve(Response.json({ sessionId: "session-synthetic", token: "synthetic-token", mustChangeSecret: true })),
  });
  const response = await proxy(jsonRequest("sessions", "POST", "{}"), context("sessions"));
  assert.deepEqual(await response.json(), { sessionId: "session-synthetic", mustChangeSecret: true });
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, /crm_session=synthetic-token/u);
  assert.match(cookie, /HttpOnly/u);
  assert.match(cookie, /SameSite=strict/iu);
  assert.match(cookie, /Secure/u);
  assert.match(cookie, /crm_first_login=required/u);
});

test("successful first-login completion clears the restricted session", async () => {
  const proxy = proxyWith({ fetch: () => Promise.resolve(Response.json({ revokedSessions: 1 })) });
  const response = await proxy(jsonRequest("first-login/change-secret", "POST", "{}"), context("first-login", "change-secret"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie") ?? "", /crm_session=/u);
});

for (const operation of ["requests", "completions"] as const) {
  test(`proxy permits only the anonymous recovery ${operation} POST and keeps service identity separate`, async () => {
    let contacted = 0;
    const proxy = proxyWith({
      getSession: () => Promise.resolve(undefined),
      getServiceAuthorization: () => Promise.resolve("Bearer synthetic-service"),
      fetch: (_input, init) => {
        contacted++;
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("authorization"), null);
        assert.equal(headers.get("x-serverless-authorization"), "Bearer synthetic-service");
        return Promise.resolve(new Response(null, { status: operation === "requests" ? 202 : 204 }));
      },
    });
    const response = await proxy(jsonRequest(`access-recovery/${operation}`, "POST", "{}"), context("access-recovery", operation));
    assert.equal(response.status, operation === "requests" ? 202 : 204);
    assert.equal(contacted, 1);
    const refused = await proxy(jsonRequest(`access-recovery/${operation}`), context("access-recovery", operation));
    assert.equal(refused.status, 401);
    assert.equal(contacted, 1);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
}

for (const path of ["access-recovery/completions", "first-login/change-secret"]) {
  test(`empty successful ${path} clears both cookies without creating a response body`, async () => {
    const proxy = proxyWith({ production: true, fetch: () => Promise.resolve(new Response(null, { status: 204 })) });
    const response = await proxy(jsonRequest(path, "POST", "{}"), context(...path.split("/")));
    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
    const cookies = response.headers.get("set-cookie") ?? "";
    assert.match(cookies, /crm_session=/u);
    assert.match(cookies, /crm_first_login=/u);
    assert.match(cookies, /Expires=Thu, 01 Jan 1970/iu);
  });
}

test("recovery stays anonymous with a stale browser session, without permitting arbitrary recovery routes", async () => {
  let calls = 0;
  const proxy = proxyWith({
    getSession: () => Promise.resolve("synthetic-stale-session"),
    fetch: (_input, init) => { calls++; assert.equal(new Headers(init?.headers).get("authorization"), null); return Promise.resolve(new Response(null, { status: 202 })); },
  });
  const response = await proxy(jsonRequest("access-recovery/requests", "POST", "{}"), context("access-recovery", "requests"));
  assert.equal(response.status, 202); assert.equal(calls, 1);
  const anonymous = proxyWith({ getSession: () => Promise.resolve(undefined), fetch: () => { assert.fail("unexpected upstream call"); } });
  for (const path of ["access-recovery", "access-recovery/requests/extra", "access-recovery/complete", "access-recovery/unknown"]) {
    const refused = await anonymous(jsonRequest(path, "POST", "{}"), context(...path.split("/")));
    assert.equal(refused.status, 401);
  }
  const oversized = await anonymous(jsonRequest("access-recovery/requests", "POST", "x".repeat(MAX_BODY_BYTES + 1)), context("access-recovery", "requests"));
  assert.equal(oversized.status, 413);
});

test("refused recovery completion preserves HTTP errors without clearing a valid browser cookie", async () => {
  const proxy = proxyWith({ fetch: () => Promise.resolve(Response.json({ code: "recovery_challenge_invalid" }, { status: 400 })) });
  const response = await proxy(jsonRequest("access-recovery/completions", "POST", "{}"), context("access-recovery", "completions"));
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(await response.json(), { code: "recovery_challenge_invalid" });
});

test("proxy refuses oversized bodies and transport failures, but preserves upstream error bodies", async () => {
  const oversized = await proxyWith()(jsonRequest("leads", "POST", "x".repeat(MAX_BODY_BYTES + 1)), context("leads"));
  assert.equal(oversized.status, 413);
  const invalidJson = await proxyWith({ fetch: () => Promise.resolve(new Response("not-json", { status: 502 })) })(jsonRequest("leads"), context("leads"));
  assert.equal(invalidJson.status, 502);
  assert.equal(await invalidJson.text(), "not-json");
  assert.equal(invalidJson.headers.get("content-type"), "text/plain;charset=UTF-8");
  const unavailable = await proxyWith({ apiOrigin: () => { throw new Error("unavailable"); } })(jsonRequest("leads"), context("leads"));
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { code: "api_proxy_unavailable" });
});
