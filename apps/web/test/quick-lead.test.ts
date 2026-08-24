import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import QuickLeadPage from "../app/leads/quick-entry/page.js";

test("renders the bounded quick call and visit lead journey", () => {
  const rendered = renderToStaticMarkup(createElement(QuickLeadPage));

  for (const expected of [
    "Nouveau lead après appel",
    "Après appel",
    "Après visite",
    "Rechercher les correspondances",
    "ROUND_ROBIN",
    "CONTROLLED_RANDOM",
    "conserve le statut, l’affectataire et la source originale",
  ]) {
    assert.match(rendered, new RegExp(expected));
  }
  assert.equal(rendered.includes("@example."), false);
});
