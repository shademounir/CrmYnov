import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import CommercialFunnelPage from "../app/manager/reports/commercial-funnel/page.js";

test("renders cohort filters, explicit loading and current-state definitions without invented metrics", async () => {
  const html = renderToStaticMarkup(await CommercialFunnelPage({ searchParams: Promise.resolve({ from: "2026-09-01", campus: "SYNTHETIC-CAMPUS", unexpected: "ignored" }) }));
  for (const expected of ["Pipeline", "Campus", "Campagne", "Formation", "Source", "date de fin est exclue", "Photographie actuelle", "pas un historique des transitions", "Chargement du Pipeline"])
    assert.match(html, new RegExp(expected, "i"));
  assert.match(html, /name="from"[^>]*value="2026-09-01"/);
  assert.match(html, /name="campus"[^>]*value="SYNTHETIC-CAMPUS"/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /role="status"/);
  assert.equal(html.includes("Aucun lead dans cette sélection"), false);
  assert.equal(html.includes("% des leads"), false);
  assert.equal(html.includes("unexpected"), false);
  assert.equal(html.includes("@example."), false);
});
