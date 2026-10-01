import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LeadWorkflowPage } from "../app/leads/[leadId]/lead-workflow-page.js";
test("renders bounded adviser selection without exposing a technical identifier field", () => {
  const html = renderToStaticMarkup(createElement(LeadWorkflowPage, { leadId: "00000000-0000-4000-8000-000000000171", surface: "assignment" }));
  for (const expected of ["Affectation et réaffectation", "Conseiller cible", "Chargement des conseillers", "campus et la règle applicables", "revérifiée"]) assert.match(html, new RegExp(expected));
  assert.doesNotMatch(html, /<input[^>]+name="targetUserId"/u);
});
