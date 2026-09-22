import assert from "node:assert/strict";
import test from "node:test";
import * as crmRoute from "../app/api/crm/[...path]/route.js";
import * as agentRoute from "../app/agent/[...path]/route.js";

test("CRM route keeps every supported verb on one controlled proxy", () => {
  assert.equal(crmRoute.dynamic, "force-dynamic");
  assert.equal(crmRoute.GET, crmRoute.POST);
  assert.equal(crmRoute.POST, crmRoute.PUT);
  assert.equal(crmRoute.PUT, crmRoute.PATCH);
  assert.equal(crmRoute.PATCH, crmRoute.DELETE);
});

test("agent route exposes only the controlled POST proxy", () => {
  assert.equal(agentRoute.dynamic, "force-dynamic");
  assert.equal(typeof agentRoute.POST, "function");
  assert.deepEqual(Object.keys(agentRoute).sort(), ["POST", "dynamic"]);
});
