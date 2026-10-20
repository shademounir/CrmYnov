import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FirstTreatmentIndicator, firstTreatmentAge } from "../app/leads/first-treatment-indicator.js";
import { FirstTreatmentCard } from "../app/manager/reports/dashboard/reporting-ui.js";

test("SLA rendering uses only server evidence, with text and stable reception origin rather than color alone", () => {
  const html = renderToStaticMarkup(createElement(FirstTreatmentIndicator, { lead: { firstTreatmentOverdue: true, firstTreatmentAgeMinutes: 1561, receptionOrigin: "CRM_OBSERVATION_BASELINE" } }));
  assert.match(html, /Premier traitement en retard/u); assert.match(html, /portefeuille historique/u); assert.match(html, /1 j 2 h/u); assert.match(html, /24 h consécutives/u);
  assert.equal(renderToStaticMarkup(createElement(FirstTreatmentIndicator, { lead: { createdAt: "2000-01-01T00:00:00Z", firstTreatmentOverdue: false } })), "");
  assert.equal(firstTreatmentAge(null), "ancienneté indisponible"); assert.equal(firstTreatmentAge(Number.NaN), "ancienneté indisponible");
});

test("zero overdue keeps the exact API queue link, never falls back to all to-contact leads", () => {
  const href = "/leads?view=FIRST_TREATMENT_OVERDUE&adviserId=adviser-synthetic&campus=campus-a";
  for (const count of [0, 2]) {
    const html = renderToStaticMarkup(createElement(FirstTreatmentCard, { report: { firstTreatmentOverdue: { count, href, thresholdHours: 24, comparison: "STRICTLY_GREATER" } } }));
    assert.match(html, /view=FIRST_TREATMENT_OVERDUE/u); assert.match(html, /adviserId=adviser-synthetic/u);
    assert.match(html, new RegExp(`data-overdue="${count > 0}"`, "u")); assert.equal(html.includes("view=TO_CONTACT"), false);
  }
  assert.match(renderToStaticMarkup(createElement(FirstTreatmentCard, { report: {} })), /compteur indisponible/u);
});
