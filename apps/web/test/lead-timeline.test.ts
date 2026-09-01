import assert from "node:assert/strict";
import test from "node:test";
import LeadTimelinePage from "../app/leads/[leadId]/timeline/page.js";

test("renders the persistent immutable timeline route", () => {
  const page = LeadTimelinePage(); const rendered = JSON.stringify(page, (key: string, item: unknown): unknown => key === "type" && typeof item === "object" ? "component" : item); assert.equal(page.type, "main"); assert.match(rendered, /Timeline du lead/);
  assert.match(rendered, /API/); assert.match(rendered, /correction compensatoire/); assert.match(rendered, /Historique immuable/);
});
