import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ImportReport } from "../app/imports/reports/[jobId]/import-report.js";

test("renders the sanitized import reconciliation report journey", () => {
  const rendered = renderToStaticMarkup(createElement(ImportReport, { jobId: "synthetic-job-0001" }));
  assert.match(rendered, /Rapport d.import/); assert.match(rendered, /sans identité de lead/);
});
