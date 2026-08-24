import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import SourceEffectivenessPage from "../app/manager/reports/source-effectiveness/page.js";

test("renders explainable source effectiveness without financial claims", () => {
  const html = renderToStaticMarkup(SourceEffectivenessPage());
  for (const expected of ["Efficacité des sources", "Canal", "Campagne", "Formation", "Mode de provenance", "Doublons",
    "Données incomplètes", "Non affectés", "À vérifier", "non calculables", "distinctement", "Africa/Casablanca", "sans ROI"])
    assert.match(html, new RegExp(expected, "i"));
  assert.equal(html.includes("@example."), false);
});
