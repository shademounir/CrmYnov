import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ImportMappingPage from "../app/imports/mapping/page.js";

test("renders the versioned mapping and non-mutating dry-run journey", () => {
  const rendered = renderToStaticMarkup(createElement(ImportMappingPage));
  assert.match(rendered, /Mapping et simulation d.import/);
  assert.match(rendered, /Non affecté/);
  assert.match(rendered, /Round-robin/);
  assert.match(rendered, /Aléatoire contrôlé/);
  assert.match(rendered, /Simuler sans importer/);
  assert.match(rendered, /non persisté, transmis uniquement à l.API locale/);
});
