import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/logout/route.js";

test("logout clears the local CRM session cookie and redirects without caching", () => {
  const response = POST(new Request("https://crm.example.invalid/api/logout", { method: "POST" }));
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
    const response = POST(new Request(`${protocol}://0.0.0.0:3000/api/logout`, { method: "POST" }));
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/");
    assert.equal(new URL(response.headers.get("location")!, "https://crm.example.invalid/api/logout").href, "https://crm.example.invalid/");
  }
});

test("logout does not use untrusted host headers or return destinations", () => {
  const response = POST(new Request("http://0.0.0.0:3000/api/logout?next=https://attacker.invalid/&returnTo=//attacker.invalid/", {
    method: "POST",
    headers: {
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
