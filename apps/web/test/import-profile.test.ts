import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ImportProfilePage from "../app/imports/profile/page.js";

test("renders a non-mutating CSV/XLSX profiling journey", () => {
  const rendered = renderToStaticMarkup(createElement(ImportProfilePage));
  assert.match(rendered, /Profiler un fichier d.import/);
  assert.match(rendered, /Forminator \/ Zapier/);
  assert.match(rendered, /CRM historique/);
  assert.match(rendered, /Analyser sans importer/);
  assert.match(rendered, /\.csv,\.xlsx/);
});
