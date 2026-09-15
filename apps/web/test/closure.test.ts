import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LeadWorkflowPage } from "../app/leads/[leadId]/lead-workflow-page.js";
test("renders the separated closure approval in the shared Lead workflow", () => {
  const html = renderToStaticMarkup(createElement(LeadWorkflowPage, { leadId: "00000000-0000-4000-8000-000000000171", surface: "closure" }));
  for (const expected of ["Clôture du Lead", "Inscrit", "Sans suite", "Non intéressé", "Preuves métier", "Soumettre au Manager", "statut reste inchangé"]) assert.match(html, new RegExp(expected));
  assert.doesNotMatch(html, /Admission confirmée/u, "a CLOSED_LOST request must not offer an ENROLLED-only reason");
});
