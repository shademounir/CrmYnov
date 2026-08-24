import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ManagerReportsDashboardPage from "../app/manager/reports/dashboard/page.js";

test("renders consolidated report navigation, common filters and safeguards", () => {
  const html = renderToStaticMarkup(ManagerReportsDashboardPage());
  for (const text of ["Tableau de bord Manager", "Filtres consolidés", "Funnel commercial", "Performance et activité", "Sources et campagnes", "Risques opérationnels", "Contributions partagées", "Aucune double attribution"]) {
    assert.equal(html.includes(text), true);
  }
  assert.equal((html.match(/Voir le détail/g) ?? []).length, 5);
});
