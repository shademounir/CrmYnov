import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ImportReportPage from "../app/imports/reports/[jobId]/page.js";

test("renders the sanitized import reconciliation report journey", () => {
  const rendered = renderToStaticMarkup(createElement(ImportReportPage, { params: { jobId: "synthetic-job-0001" } }));
  assert.match(rendered, /Rapport d.import/); assert.match(rendered, /sans identité de lead/);
});
