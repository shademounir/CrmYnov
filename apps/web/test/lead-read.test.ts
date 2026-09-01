import assert from "node:assert/strict";
import test from "node:test";
import LeadsPage from "../app/leads/page.js";
import LeadDetailPage, { leadSectionHref } from "../app/leads/[leadId]/page.js";

function renderStructure(value: unknown): string {
  return JSON.stringify(value, (key: string, item: unknown): unknown =>
    key === "type" && typeof item === "object" ? "component" : item,
  );
}

test("renders shareable search and combined lead filters", () => { const rendered = renderStructure(LeadsPage()); assert.match(rendered, /Tous les leads/); assert.match(rendered, /Pagination/); assert.match(rendered, /assignedToId/); assert.match(rendered, /search/); assert.match(rendered, /method/); });
test("renders a role-aware persistent lead detail", () => { const rendered = renderStructure(LeadDetailPage()); assert.match(rendered, /Fiche lead persistante/); assert.match(rendered, /contacts sont masqués/); assert.equal(leadSectionHref("lead/id", "timeline"), "/leads/lead%2Fid/timeline"); });
test("renders operational work views and assignment filters", () => { const rendered = renderStructure(LeadsPage()); for (const expected of ["Mes leads", "À relancer", "Non affectés", "Sans activité", "Clôturés", "assignmentMode", "importBatchId", "Forminator/Zapier", "Ynov.ma historique", "Appels", "Visites", "JobInTech", "Sources non classifiées", "À compléter", "Imports en erreur"]) assert.match(rendered, new RegExp(expected)); });
