import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import CommercialPerformancePage from "../app/manager/reports/commercial-performance/page.js";

test("renders explicit operational KPIs, filters and non-disciplinary safeguards", () => {
  const html = renderToStaticMarkup(CommercialPerformancePage());
  for (const expected of ["Performance et activité", "Leads principaux", "Contributions secondaires", "Charge active",
    "Relances en retard", "Traitements datés anciens", "Africa/Casablanca", "divisions par zéro", "ne doublonnent jamais", "score opaque"])
    assert.match(html, new RegExp(expected, "i"));
  assert.equal(html.includes("@example."), false);
  assert.match(html, /Historiques non datés, dossiers jamais traités et clôturés exclus/u);
  assert.match(html, /affectations et écritures techniques ne rajeunissent pas/u);
  assert.doesNotMatch(html, /Sans interaction|Inactivité après/u);
});
