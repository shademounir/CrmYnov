import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import CommercialFunnelPage from "../app/manager/reports/commercial-funnel/page.js";

test("renders secured funnel filters and non-misleading KPI definitions", () => {
  const html = renderToStaticMarkup(CommercialFunnelPage());
  for (const expected of ["Funnel commercial", "Campus", "Campagne", "Formation", "Source", "commercial-funnel-v1", "Africa/Casablanca", "état courant", "pas une reconstitution"])
    assert.match(html, new RegExp(expected, "i"));
  assert.equal(html.includes("@example."), false);
});
