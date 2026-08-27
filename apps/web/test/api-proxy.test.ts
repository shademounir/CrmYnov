import assert from "node:assert/strict";
import test from "node:test";
import { apiOrigin, MAX_BODY_BYTES, safePath } from "../app/api/crm/proxy-policy.js";

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
