import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LeadWorkflowPage } from "../app/leads/[leadId]/lead-workflow-page.js";
test("renders the persistent immutable timeline route with the shared interaction form", () => {
  const html = renderToStaticMarkup(createElement(LeadWorkflowPage, { leadId: "00000000-0000-4000-8000-000000000171", surface: "interaction" }));
  for (const expected of ["Historique et interactions", "historique protégé", "Nouvelle interaction", "Injoignable", "sans réécriture"]) assert.match(html, new RegExp(expected, "i"));
});
