import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/logout/route.js";

test("logout clears the local CRM session cookie and redirects without caching", () => {
  const response = POST(new Request("https://crm.example.invalid/api/logout", { method: "POST" }));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "https://crm.example.invalid/");
  assert.match(response.headers.get("set-cookie") ?? "", /crm_session=;.*Expires=Thu, 01 Jan 1970 00:00:00 GMT/u);
  assert.match(response.headers.get("set-cookie") ?? "", /crm_first_login=;/u);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
