import assert from "node:assert/strict";
import test from "node:test";
import LeadTimelinePage from "../app/leads/[leadId]/timeline/page.js";

test("renders the synthetic immutable timeline route", () => {
  const page = LeadTimelinePage(); assert.equal(page.type, "main"); assert.match(JSON.stringify(page), /Timeline du lead/); assert.match(JSON.stringify(page), /synthétiques/);
});
