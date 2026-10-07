import assert from "node:assert/strict";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import test from "node:test";
import { NodeNextRequest } from "next/dist/server/base-http/node.js";
import { NextRequestAdapter } from "next/dist/server/web/spec-extension/adapters/next-request.js";
import { createProxy, type ProxyDependencies } from "../app/api/crm/proxy.js";
import { MAX_BODY_BYTES } from "../app/api/crm/proxy-policy.js";
import { createAgentProxy } from "../app/agent/agent-proxy.js";

const origin = "https://crm.example.test";

function context(path: string): { params: Promise<{ path: string[] }> } {
  return { params: Promise.resolve({ path: path.split("/") }) };
}

function proxy(overrides: Partial<ProxyDependencies> = {}): ReturnType<typeof createProxy> {
  return createProxy({ apiOrigin: () => "https://api.example.test", publicOrigin: () => origin, getSession: () => Promise.resolve("synthetic-session"), randomId: () => "synthetic-correlation", production: true, fetch: () => Promise.resolve(Response.json({ ok: true })), ...overrides });
}

function nodeAdapterRequest(path: string, method: string, headers: Record<string, string>, body?: string): Request {
  const incoming = new IncomingMessage(new Socket());
  incoming.method = method;
  incoming.url = `http://0.0.0.0:3000/api/crm/${path}`;
  incoming.headers = headers;
  if (body !== undefined) incoming.push(Buffer.from(body));
  incoming.push(null);
  return NextRequestAdapter.fromNodeNextRequest(new NodeNextRequest(incoming), new AbortController().signal);
}

test("hostile browser mutations are refused before cookie, body, service identity or API access", async () => {
  const handler = proxy({
    getSession: () => { assert.fail("cookie read"); },
    getServiceAuthorization: () => { assert.fail("IAM request"); },
    fetch: () => { assert.fail("API request"); },
  });
  for (const path of ["leads", "sessions", "invitations/completions", "first-login/change-secret", "access-recovery/requests", "access-recovery/completions"]) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const request = new Request(`https://crm.example.test/api/crm/${path}`, { method, headers: { origin: "https://other.example.test", "sec-fetch-site": "same-site", "content-type": "application/json" }, body: "{}" });
      const response = await handler(request, context(path));
      assert.equal(response.status, 403);
      assert.equal(request.bodyUsed, false);
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), { code: "browser_origin_refused" });
    }
  }
});

test("anonymous browser entry points retain their exact contract only after same-origin verification", async () => {
  for (const path of ["sessions", "invitations/completions", "access-recovery/requests", "access-recovery/completions"]) {
    let calls = 0;
    const handler = proxy({ getSession: () => Promise.resolve(undefined), fetch: (_input, init) => {
      calls++; assert.equal(new Headers(init?.headers).get("authorization"), null);
      return Promise.resolve(Response.json({ ok: true }));
    } });
    const response = await handler(new Request(`https://crm.example.test/api/crm/${path}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}" }), context(path));
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
  }
});

test("non-JSON mutation bodies are refused before cookies or IAM and malformed JSON before IAM", async () => {
  for (const contentType of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=synthetic"]) {
    const handler = proxy({ getSession: () => { assert.fail("cookie read"); }, fetch: () => { assert.fail("API request"); } });
    const response = await handler(new Request("https://crm.example.test/api/crm/leads", { method: "POST", headers: { origin, "content-type": contentType }, body: "{}" }), context("leads"));
    assert.equal(response.status, 415);
  }
  const request = new Request("https://crm.example.test/api/crm/leads", { method: "POST", headers: { origin }, body: new Uint8Array([123, 125]) });
  assert.equal(request.headers.get("content-type"), null);
  assert.equal((await proxy()(request, context("leads"))).status, 415);
  const invalid = await proxy({ getServiceAuthorization: () => { assert.fail("IAM request"); }, fetch: () => { assert.fail("API request"); } })(new Request("https://crm.example.test/api/crm/leads", { method: "POST", headers: { origin, "content-type": "application/json" }, body: "not-json" }), context("leads"));
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { code: "request_json_invalid" });
});

test("same-origin bodyless call ending and view deletion remain authenticated and bodyless", async () => {
  for (const [path, method] of [["calls/synthetic/end", "POST"], ["lead-views/synthetic", "DELETE"]] as const) {
    const response = await proxy({ fetch: (_input, init) => {
      assert.equal(init?.body, undefined);
      assert.equal(new Headers(init?.headers).get("content-type"), null);
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-session");
      return Promise.resolve(new Response(null, { status: 204 }));
    } })(new Request(`http://0.0.0.0:3000/api/crm/${path}`, { method, headers: { origin } }), context(path));
    assert.equal(response.status, 204);
  }
});

test("Next Node adapter zero-byte mutation streams remain authenticated and are relayed without a body", async () => {
  for (const [path, method] of [["calls/synthetic/end", "POST"], ["lead-views/synthetic", "DELETE"]] as const) {
    for (const contentType of [undefined, "application/json", "text/plain"]) {
      const headers: Record<string, string> = { origin, "sec-fetch-site": "same-origin", "content-length": "0" };
      if (contentType) headers["content-type"] = contentType;
      const request = nodeAdapterRequest(path, method, headers);
      assert.notEqual(request.body, null, "the real Node adapter exposes an empty IncomingMessage as a body stream");
      let calls = 0;
      const response = await proxy({ fetch: (_input, init) => {
        calls++;
        assert.equal(init?.body, undefined);
        const upstreamHeaders = new Headers(init?.headers);
        assert.equal(upstreamHeaders.get("content-type"), null);
        assert.equal(upstreamHeaders.get("authorization"), "Bearer synthetic-session");
        return Promise.resolve(new Response(null, { status: 204 }));
      } })(request, context(path));
      assert.equal(response.status, 204);
      assert.equal(calls, 1);
    }
  }
});

test("Next Node adapter zero-byte mutations still require authentication and a verified source", async () => {
  for (const [path, method] of [["calls/synthetic/end", "POST"], ["lead-views/synthetic", "DELETE"]] as const) {
    const unauthenticated = await proxy({ getSession: () => Promise.resolve(undefined), fetch: () => { assert.fail("API request"); } })(nodeAdapterRequest(path, method, { origin, "sec-fetch-site": "same-origin" }), context(path));
    assert.equal(unauthenticated.status, 401);
    assert.deepEqual(await unauthenticated.json(), { code: "authentication_required" });
    for (const headers of [{ origin: "https://other.example.test", "sec-fetch-site": "same-site" }, { origin, "sec-fetch-site": "cross-site" }, {}]) {
      const request = nodeAdapterRequest(path, method, headers);
      assert.notEqual(request.body, null);
      request.body!.getReader = (): never => { assert.fail("body read"); };
      const refused = await proxy({ getSession: () => { assert.fail("cookie read"); }, getServiceAuthorization: () => { assert.fail("IAM request"); }, fetch: () => { assert.fail("API request"); } })(request, context(path));
      assert.equal(refused.status, 403);
      assert.equal(request.bodyUsed, false);
      assert.deepEqual(await refused.json(), { code: "browser_origin_refused" });
    }
  }
});

test("Next Node adapter nonempty bodies cannot masquerade as bodyless via Content-Length", async () => {
  for (const [contentType, expectedStatus, code] of [[undefined, 415, "request_json_required"], ["text/plain", 415, "request_json_required"], ["application/json", 400, "request_json_invalid"]] as const) {
    const headers: Record<string, string> = { origin, "content-length": "0" };
    if (contentType) headers["content-type"] = contentType;
    const request = nodeAdapterRequest("leads", "POST", headers, "not-json");
    const response = await proxy({ getSession: () => { assert.fail("cookie read"); }, getServiceAuthorization: () => { assert.fail("IAM request"); }, fetch: () => { assert.fail("API request"); } })(request, context("leads"));
    assert.equal(response.status, expectedStatus);
    assert.deepEqual(await response.json(), { code });
  }
});

test("non-JSON and oversized streaming bodies are cancelled before reading the remaining body or credentials", async () => {
  for (const [contentType, firstChunk, expectedStatus, code] of [["text/plain", new Uint8Array([123]), 415, "request_json_required"], ["application/json", new Uint8Array(MAX_BODY_BYTES + 1), 413, "request_too_large"]] as const) {
    let pulls = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller): void { pulls++; assert.equal(pulls, 1, "the rejected body's remainder must not be read"); controller.enqueue(firstChunk); },
      cancel(): void { cancelled = true; },
    }, { highWaterMark: 0 });
    const request = new Request("https://crm.example.test/api/crm/leads", { method: "POST", headers: { origin, "content-type": contentType }, body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
    const response = await proxy({ getSession: () => { assert.fail("cookie read"); }, getServiceAuthorization: () => { assert.fail("IAM request"); }, fetch: () => { assert.fail("API request"); } })(request, context("leads"));
    assert.equal(response.status, expectedStatus);
    assert.deepEqual(await response.json(), { code });
    assert.equal(pulls, 1);
    assert.equal(cancelled, true);
  }
});

test("same-origin JSON charset and DELETE bodies are relayed without browser credentials leaking", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    let calls = 0;
    const response = await proxy({ fetch: (_input, init) => {
      calls++;
      assert.equal(new Headers(init?.headers).get("content-type"), "application/json");
      assert.equal(new Headers(init?.headers).get("cookie"), null);
      assert.equal(new TextDecoder().decode(init?.body as ArrayBuffer), "{}");
      return Promise.resolve(Response.json({ ok: true }));
    } })(new Request("http://0.0.0.0:3000/api/crm/leads", { method, headers: { origin, "content-type": "application/json; charset=utf-8", cookie: "crm_session=synthetic-session", "x-forwarded-host": "attacker.invalid" }, body: "{}" }), context("leads"));
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
  }
});

test("missing runtime origin refuses mutations without contacting the API but preserves authenticated reads", async () => {
  let calls = 0;
  const handler = proxy({ publicOrigin: () => "", fetch: () => { calls++; return Promise.resolve(Response.json([])); } });
  const write = await handler(new Request("https://crm.example.test/api/crm/leads", { method: "POST", headers: { origin } }), context("leads"));
  assert.equal(write.status, 503);
  assert.equal(calls, 0);
  assert.deepEqual(await write.json(), { code: "browser_origin_unavailable" });
  const read = await handler(new Request("https://crm.example.test/api/crm/leads"), context("leads"));
  assert.equal(read.status, 200);
  assert.equal(calls, 1);
});

test("native token gateway still accepts a bodyless poll without Origin or browser cookies", async () => {
  let calls = 0;
  const handler = createAgentProxy({ apiOrigin: () => "https://api.example.test", randomId: () => "synthetic-agent", fetch: (_input, init) => {
    calls++;
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-telephony-agent-token"), "synthetic-device-token");
    assert.equal(headers.get("authorization"), null);
    assert.equal(headers.get("cookie"), null);
    return Promise.resolve(Response.json({ command: null }));
  } });
  const path = "integrations/telephony/agent/v1/poll";
  const response = await handler(new Request(`https://crm.example.test/agent/${path}`, { method: "POST", headers: { "x-telephony-agent-token": "synthetic-device-token", cookie: "crm_session=synthetic-browser-token" } }), context(path));
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});
