import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ManagerAssignmentPage from "../app/manager/assignment/page.js";

test("renders the Manager assignment KPIs, alerts and bounded actions", () => {
  const html = renderToStaticMarkup(ManagerAssignmentPage());
  for (const expected of ["Pilotage des affectations", "Non affectés", "À relancer", "Charge par conseiller", "Configurer ou simuler", "Affecter un lead ou un lot", "autorité finale"])
    assert.match(html, new RegExp(expected));
  assert.equal(html.includes("@example."), false);
});
