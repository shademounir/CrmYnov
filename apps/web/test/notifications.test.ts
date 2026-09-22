import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadNotifications, NotificationCenter } from "../app/notifications/notification-center.js";
import NotificationsPage from "../app/notifications/page.js";

const response = (status: number, body: unknown = {}): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("renders the Relation Ynov notification center with an explicit loading state", () => {
  const page = renderToStaticMarkup(createElement(NotificationsPage));
  for (const value of ["Centre de notifications", "Alertes internes", "sans modifier vos droits"]) assert.match(page, new RegExp(value));
  const center = renderToStaticMarkup(createElement(NotificationCenter));
  assert.match(center, /Chargement des notifications/);
});

test("maps ready, session, forbidden and unavailable responses without fallback data", async () => {
  const ready = await loadNotifications(1, (() => Promise.resolve(response(200, { items: [], page: 1, pageSize: 25, total: 0, unread: 0 }))) as typeof fetch);
  assert.equal(ready.kind, "ready");
  assert.equal(await loadNotifications(1, (() => Promise.resolve(response(401))) as typeof fetch).then((value) => value.kind), "session");
  assert.equal(await loadNotifications(1, (() => Promise.resolve(response(403))) as typeof fetch).then((value) => value.kind), "forbidden");
  assert.equal(await loadNotifications(1, (() => Promise.resolve(response(503))) as typeof fetch).then((value) => value.kind), "error");
});
