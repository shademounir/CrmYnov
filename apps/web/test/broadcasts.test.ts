import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import BroadcastsPage from "../app/broadcasts/page.js";
import BroadcastSummaryPage from "../app/broadcasts/[broadcastId]/page.js";

test("renders persistent broadcast authoring and immutable history", () => {
  const html = renderToStaticMarkup(BroadcastsPage());
  for (const text of ["Broadcast interne", "Préparer un brouillon", "Créer le brouillon via l’API", "Chargement depuis l’API locale", "collaborateurs actifs"]) assert.equal(html.includes(text), true);
  assert.equal(html.includes("@example"), false); assert.equal(html.includes("+212"), false); assert.equal(html.includes("https://"), false);
});

test("renders a role-bounded broadcast summary without recipient identities", async () => {
  const html = renderToStaticMarkup(await BroadcastSummaryPage({ params: Promise.resolve({ broadcastId: "broadcast-synthetic-1" }) }));
  for (const text of ["Résumé du broadcast interne", "broadcast-synthetic-1", "RBAC", "Snapshot immuable", "notification compensatoire"]) assert.equal(html.includes(text), true);
  assert.equal(html.includes("Destinataire synthétique"), false);
});
