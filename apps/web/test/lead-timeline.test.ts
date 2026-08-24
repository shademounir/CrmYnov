import assert from "node:assert/strict";
import test from "node:test";
import LeadTimelinePage from "../app/leads/[leadId]/timeline/page.js";

test("renders the synthetic immutable timeline route", () => {
  const page = LeadTimelinePage(); const rendered = JSON.stringify(page); assert.equal(page.type, "main"); assert.match(rendered, /Timeline du lead/);
  assert.match(rendered, /synthétiques/); assert.match(rendered, /correction compensatoire/); assert.match(rendered, /corrige.*evt-1/);
});
