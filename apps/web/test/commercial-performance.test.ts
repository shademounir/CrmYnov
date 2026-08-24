import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import CommercialPerformancePage from "../app/manager/reports/commercial-performance/page.js";

test("renders explicit operational KPIs, filters and non-disciplinary safeguards", () => {
  const html = renderToStaticMarkup(CommercialPerformancePage());
  for (const expected of ["Performance et activité", "Leads principaux", "Contributions secondaires", "Charge active",
    "Relances en retard", "Sans interaction", "Africa/Casablanca", "divisions par zéro", "ne doublonnent jamais", "score opaque"])
    assert.match(html, new RegExp(expected, "i"));
  assert.equal(html.includes("@example."), false);
});
