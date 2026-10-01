import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ImportWizardPage from "../app/imports/wizard/page.js";

test("renders the ten-step fail-closed import wizard", () => {
  const html = renderToStaticMarkup(createElement(ImportWizardPage));
  for (const expected of ["Fichier", "Qualité et doublons", "Dry-run", "Rapport final", "FORMINATOR_ZAPIER", "CUSTOM_CONTROLLED", "preuve"])
    assert.match(html, new RegExp(expected));
  assert.equal(html.includes("@example."), false);
});
