import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LeadWorkflowPage } from "../app/leads/[leadId]/lead-workflow-page.js";
test("renders the controlled Lead status workflow", () => {
  const html = renderToStaticMarkup(createElement(LeadWorkflowPage, { leadId: "00000000-0000-4000-8000-000000000171", surface: "status" }));
  assert.match(html, /Étape commerciale/); assert.match(html, /contrôlés par l.API/); assert.match(html, /historique/); assert.match(html, /demandes de clôture/);
});
