import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ManagerAssignmentPage from "../app/manager/assignment/page.js";

test("renders the persistent Manager assignment dashboard and bounded actions", () => {
  const html = renderToStaticMarkup(ManagerAssignmentPage());
  for (const expected of ["Pilotage des affectations", "API persistante", "Chargement depuis l’API locale", "Prévisualiser ou confirmer une affectation", "Prévisualiser sans modifier", "Confirmer via l’API"])
    assert.match(html, new RegExp(expected));
  assert.equal(html.includes("@example."), false);
});
