import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import BroadcastsPage from "../app/broadcasts/page.js";
import BroadcastSummaryPage from "../app/broadcasts/[broadcastId]/page.js";

test("renders the accessible synthetic broadcast authoring and immutable history journey", () => {
  const html = renderToStaticMarkup(BroadcastsPage());
  for (const text of ["Broadcast interne", "Préparer un brouillon", "Prévisualiser l&#x27;audience", "3 destinataires internes synthétiques", "Je confirme explicitement", "Historique immuable", "correction compensatoire"]) assert.equal(html.includes(text), true);
  assert.equal(html.includes("@example"), false); assert.equal(html.includes("+212"), false); assert.equal(html.includes("https://"), false);
});

test("renders a role-bounded broadcast summary without recipient identities", async () => {
  const html = renderToStaticMarkup(await BroadcastSummaryPage({ params: Promise.resolve({ broadcastId: "broadcast-synthetic-1" }) }));
  for (const text of ["Résumé du broadcast interne", "broadcast-synthetic-1", "RBAC", "Snapshot immuable", "notification compensatoire"]) assert.equal(html.includes(text), true);
  assert.equal(html.includes("Destinataire synthétique"), false);
});
