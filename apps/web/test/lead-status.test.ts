import assert from "node:assert/strict";
import test from "node:test";
import LeadStatusPage from "../app/leads/[leadId]/status/page.js";

test("renders the controlled lead status workflow", () => {
  const page = LeadStatusPage(); const rendered = JSON.stringify(page);
  assert.equal(page.type, "main"); assert.match(rendered, /Progression du lead/); assert.match(rendered, /Manager\/Admin/); assert.match(rendered, /timeline immuable/);
});
