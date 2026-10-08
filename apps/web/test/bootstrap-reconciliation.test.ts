import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BootstrapReconciliationView } from "../app/imports/bootstrap/bootstrap-reconciliation.js";
import type { BootstrapReconciliation } from "../app/imports/bootstrap/bootstrap-client.js";

const summary: BootstrapReconciliation = {
  complete: false, truncated: false, totalOccurrences: 4, unresolvedOccurrences: 3,
  effects: { expectedNotes: 1, persistedNotes: 1, exactNotes: 1, expectedRowReceipts: 1, persistedRowReceipts: 1, exactRowReceipts: 1 },
  contacts: { email: { groups: 1, occurrences: 2 }, phone: { groups: 1, occurrences: 2 }, overlappingGroupsNotUniquePeople: true },
  currentDossierAxes: { visible: 0, withheld: 1 }, axes: { sourceStatus: { "<script>source</script>": 1 }, cyclePeriod: { "CONFIRMED_TARGET:2027-2028": 1 } },
  discrepancies: [{ code: "EXPECTED_NOTE_MISSING", count: 1 }],
};
test("a missing detailed report never becomes a fabricated complete zero", () => {
  const html = renderToStaticMarkup(createElement(BootstrapReconciliationView));
  assert.match(html, /n’a pas été fournie par l’API/u); assert.doesNotMatch(html, /rapprochés exactement/u);
});
test("reconciliation separates effects, overlapping contacts, historical cycles and withheld current axes", () => {
  const html = renderToStaticMarkup(createElement(BootstrapReconciliationView, { summary }));
  for (const expected of ["bascule reste bloquée", "Notes vérifiées exactement", "Reçus de ligne vérifiés", "personnes uniques", "1 dossier(s) exclu(s)", "CONFIRMED_TARGET:2027-2028", "EXPECTED_NOTE_MISSING", "Non prouvé"]) assert.ok(html.includes(expected), expected);
  assert.equal(html.includes("<script>"), false); assert.ok(html.includes("&lt;script&gt;source&lt;/script&gt;"));
});
test("truncated or complete technical results keep production prerequisites explicitly distinct", () => {
  const truncated = renderToStaticMarkup(createElement(BootstrapReconciliationView, { summary: { ...summary, truncated: true } }));
  assert.match(truncated, /Lecture bornée tronquée/u);
  const complete = renderToStaticMarkup(createElement(BootstrapReconciliationView, { summary: { ...summary, complete: true, discrepancies: [], currentDossierAxes: { visible: 1, withheld: 0 } } }));
  assert.match(complete, /ne valide pas les autres prérequis de production/u); assert.doesNotMatch(complete, /production approuvée/u);
});
