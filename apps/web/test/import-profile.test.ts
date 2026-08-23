import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ImportProfilePage, { LegacyQualityPanel } from "../app/imports/profile/page.js";

test("renders a non-mutating CSV/XLSX profiling journey", () => {
  const rendered = renderToStaticMarkup(createElement(ImportProfilePage));
  assert.match(rendered, /Profiler un fichier d.import/);
  assert.match(rendered, /Forminator \/ Zapier/);
  assert.match(rendered, /CRM historique/);
  assert.match(rendered, /Analyser sans importer/);
  assert.match(rendered, /\.csv,\.xlsx/);
});

test("renders only aggregate legacy quality and fail-closed cutover reasons", () => {
  const rendered = renderToStaticMarkup(createElement(LegacyQualityPanel, { quality: { rowCount: 3, emptyCellCount: 4, duplicateEmailRows: 1,
    duplicatePhoneRows: 0, unknownStatusRows: 1, invalidDateRows: 1, populatedOwnerRows: 2, distinctOwnerCount: 1, commentedRows: 1,
    cutoverBlocked: true, blockerReasons: ["historical_status_unknown"] } }));
  assert.match(rendered, /Cutover : bloqué/);
  assert.match(rendered, /Doublons email :.*1/);
  assert.match(rendered, /historical_status_unknown/);
});
