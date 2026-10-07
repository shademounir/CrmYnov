import assert from "node:assert/strict";
import test from "node:test";
import { browserOriginRefusal, jsonContentType, publicOrigin } from "../app/api/browser-origin.js";

const expected = "https://crm.example.test";

function request(headers: HeadersInit = {}, method = "POST"): Request {
  return new Request("http://0.0.0.0:3000/api/crm/leads", { method, headers });
}

test("public origin is explicit, canonical and independent of incoming proxy headers", () => {
  for (const value of [expected, `${expected}/`, "http://localhost:3040", "http://127.0.0.1:3040", "http://[::1]:3040"]) {
    assert.equal(publicOrigin({ CRM_PUBLIC_ORIGIN: value }), new URL(value).origin);
  }
  for (const value of ["", "http://crm.example.test", "https://*.example.test", "https://user@crm.example.test", `${expected}/path`, `${expected}?x=1`, `${expected}#secret`, `${expected},https://evil.test`, "https://CRM.EXAMPLE.TEST", "https://crm.example.test:443"]) {
    assert.throws(() => publicOrigin({ CRM_PUBLIC_ORIGIN: value }));
  }
  assert.throws(() => publicOrigin({ HOST: "crm.example.test", "X-Forwarded-Host": "crm.example.test" }));
});

test("safe reads do not require or consult browser mutation configuration", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    assert.equal(browserOriginRefusal(request({}, method), () => { assert.fail("origin configuration must not be read"); }), undefined);
  }
});

test("all mutating methods require the configured exact origin", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(browserOriginRefusal(request({ origin: expected, "sec-fetch-site": "same-origin" }, method), () => expected), undefined);
    assert.deepEqual(browserOriginRefusal(request({}, method), () => expected), { status: 403, code: "browser_origin_refused" });
  }
});

test("origin verification rejects sibling, lookalike, opaque, malformed and contradictory sources", () => {
  for (const origin of ["https://other.example.test", "https://crm.example.test.evil.test", "http://crm.example.test", "https://crm.example.test:8443", `${expected}/path`, `${expected}/`, `https://user@crm.example.test`, `${expected}, https://evil.test`, "null", ""]) {
    const refusal = browserOriginRefusal(request({ origin, referer: `${expected}/leads` }), () => expected);
    assert.deepEqual(refusal, { status: 403, code: "browser_origin_refused" });
  }
  for (const site of ["cross-site", "same-site", "unexpected", "same-origin, cross-site"]) {
    assert.equal(browserOriginRefusal(request({ origin: expected, "sec-fetch-site": site }), () => expected)?.status, 403);
  }
  assert.equal(browserOriginRefusal(request({ origin: expected, "sec-fetch-site": "none" }), () => expected), undefined);
});

test("Referer fallback is exact and does not turn hostile Origin into an allowed request", () => {
  assert.equal(browserOriginRefusal(request({ referer: `${expected}/leads?view=ACTIVE` }), () => expected), undefined);
  for (const referer of ["null", "not-a-url", "https://evil.test/", "https://user@crm.example.test/leads", "https://crm.example.test.evil.test/"]) {
    assert.equal(browserOriginRefusal(request({ referer }), () => expected)?.status, 403);
  }
  assert.equal(browserOriginRefusal(request({ origin: "https://evil.test", referer: `${expected}/leads` }), () => expected)?.status, 403);
});

test("public-origin configuration fails closed, even when proxy headers claim a safe target", () => {
  const incoming = request({ origin: expected, host: "crm.example.test", "x-forwarded-host": "crm.example.test", "x-forwarded-proto": "https" });
  for (const value of ["", "http://crm.example.test", "https://user@crm.example.test", `${expected}/path`]) {
    assert.deepEqual(browserOriginRefusal(incoming, () => value), { status: 503, code: "browser_origin_unavailable" });
  }
  assert.deepEqual(browserOriginRefusal(incoming, () => { throw new Error("synthetic config failure"); }), { status: 503, code: "browser_origin_unavailable" });
});

test("JSON content types cannot accept simple form bodies re-labelled by the BFF", () => {
  for (const value of ["application/json", "application/json; charset=utf-8", "Application/JSON; charset = \"UTF-8\""]) assert.equal(jsonContentType(new Headers({ "content-type": value })), true);
  for (const value of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=synthetic", "application/json, text/plain", "application/json; charset=latin1", "application/problem+json", ""]) assert.equal(jsonContentType(new Headers({ "content-type": value })), false);
  assert.equal(jsonContentType(new Headers()), false);
});
