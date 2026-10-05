import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import QuickLeadPage from "../app/leads/quick-entry/page.js";

test("renders the bounded quick call and visit lead journey", () => {
  const rendered = renderToStaticMarkup(createElement(QuickLeadPage));

  for (const expected of [
    "Nouveau Lead après appel ou visite",
    "création persistante",
    "ne sont pas raccordés à la persistance PostgreSQL",
    "Ouvrir la création de Lead",
    "Rechercher un Lead existant",
  ]) {
    assert.match(rendered, new RegExp(expected));
  }
  assert.equal(rendered.includes("@example."), false);
  assert.equal(rendered.includes("<form"), false);
});
