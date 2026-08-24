import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import OperationalRisksPage from "../app/manager/reports/operational-risks/page.js";

test("renders explicit operational thresholds and non-disciplinary safeguards", () => {
  const html = renderToStaticMarkup(OperationalRisksPage());
  for (const value of ["Charge, réactivité", "Première interaction", "Relances échues", "Alerte capacité", "Risque source", "aucun score disciplinaire", "RBAC"]) assert.equal(html.includes(value), true);
});
