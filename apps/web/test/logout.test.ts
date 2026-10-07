import assert from "node:assert/strict";
import test from "node:test";
import { createLogout } from "../app/api/logout/logout-handler.js";

const POST = createLogout(() => "https://crm.example.invalid");

test("logout clears the local CRM session cookie and redirects without caching", () => {
  const response = POST(new Request("https://crm.example.invalid/api/logout", { method: "POST", headers: { origin: "https://crm.example.invalid" } }));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/");
  assert.deepEqual(response.headers.getSetCookie(), [
    "crm_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "crm_first_login=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ]);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.body, null);
});

test("logout keeps a relative redirect when standalone exposes its internal listening origin", () => {
  for (const protocol of ["http", "https"]) {
    const response = POST(new Request(`${protocol}://0.0.0.0:3000/api/logout`, { method: "POST", headers: { origin: "https://crm.example.invalid" } }));
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/");
    assert.equal(new URL(response.headers.get("location")!, "https://crm.example.invalid/api/logout").href, "https://crm.example.invalid/");
  }
});

test("logout does not use untrusted host headers or return destinations", () => {
  const response = POST(new Request("http://0.0.0.0:3000/api/logout?next=https://attacker.invalid/&returnTo=//attacker.invalid/", {
    method: "POST",
    headers: {
      origin: "https://crm.example.invalid",
      host: "attacker.invalid",
      forwarded: "host=attacker.invalid;proto=http",
      "x-forwarded-host": "attacker.invalid, crm.example.invalid",
      "x-forwarded-proto": "http",
    },
  }));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("logout refuses hostile, opaque or absent origins without clearing cookies", async () => {
  for (const headers of [{ origin: "https://attacker.invalid" }, { origin: "null" }, {}]) {
    const response = POST(new Request("https://crm.example.invalid/api/logout", { method: "POST", headers }));
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { code: "browser_origin_refused" });
  }
});

test("logout permits its same-origin HTML form and verified Referer fallback", () => {
  const response = POST(new Request("https://crm.example.invalid/api/logout", {
    method: "POST", headers: { referer: "https://crm.example.invalid/leads", "content-type": "application/x-www-form-urlencoded", "sec-fetch-site": "same-origin" }, body: "",
  }));
  assert.equal(response.status, 303);
  assert.equal(response.headers.getSetCookie().length, 2);
});

test("logout fails closed when its runtime origin is missing", () => {
  const response = createLogout(() => "")(new Request("https://crm.example.invalid/api/logout", { method: "POST", headers: { origin: "https://crm.example.invalid" } }));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("set-cookie"), null);
});
