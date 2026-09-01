import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AppShellClient,
  AppShellView,
  isActive,
  loadSearchResults,
  searchItems,
  type SearchState,
} from "../app/_components/app-shell.js";

const noop = (): void => undefined;

function renderShell(search: SearchState, overrides: Partial<Parameters<typeof AppShellView>[0]> = {}): string {
  return renderToStaticMarkup(createElement(AppShellView, {
    pathname: "/manager/reports/dashboard",
    collapsed: false,
    mobileOpen: false,
    profileOpen: false,
    query: "lead",
    search,
    onCollapse: noop,
    onMobileOpen: noop,
    onMobileClose: noop,
    onProfileToggle: noop,
    onQueryChange: noop,
    onSearchSelect: noop,
    children: createElement("main", null, "Contenu connecté"),
    ...overrides,
  }));
}

function response(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("recognizes only the active CRM route", () => {
  assert.equal(isActive("/leads", "/leads"), true);
  assert.equal(isActive("/leads/123", "/leads"), false);
  assert.equal(isActive("/appointments/123", "/appointments"), true);
  assert.equal(isActive("/manager/reports/dashboard", "/manager/reports/dashboard"), true);
  assert.equal(isActive("/manager/reports/commercial-performance", "/manager/reports/dashboard"), false);
});

test("normalizes global search results without exposing unknown fields", () => {
  assert.deepEqual(searchItems({ items: [{ id: "lead-1", firstName: "Lead", lastName: "Synthétique", leadCode: "LD-SYN-1", program: "Programme" }, { firstName: "Sans id" }] }), [
    { id: "lead-1", label: "Lead Synthétique", detail: "LD-SYN-1 · Programme" },
  ]);
  assert.deepEqual(searchItems([{ id: "lead-2" }]), [
    { id: "lead-2", label: "Lead", detail: "Sans identifiant · Formation non renseignée" },
  ]);
});

test("loads every bounded global-search state", async () => {
  const signal = new AbortController().signal;
  const ready = await loadSearchResults("lead", signal, (() => Promise.resolve(response(200, { items: [{ id: "lead-1", firstName: "Lead" }] }))) as typeof fetch);
  assert.equal(ready.kind, "ready");
  assert.equal(await loadSearchResults("none", signal, (() => Promise.resolve(response(200, { items: [] }))) as typeof fetch).then((value) => value.kind), "empty");
  assert.equal(await loadSearchResults("lead", signal, (() => Promise.resolve(response(401))) as typeof fetch).then((value) => value.kind), "session");
  assert.equal(await loadSearchResults("lead", signal, (() => Promise.resolve(response(403))) as typeof fetch).then((value) => value.kind), "forbidden");
  assert.equal(await loadSearchResults("lead", signal, (() => Promise.resolve(response(503))) as typeof fetch).then((value) => value.kind), "error");
});

test("renders the responsive shell and every explicit search state", () => {
  const ready = renderShell({ kind: "ready", items: [{ id: "lead/id", label: "Lead Synthétique", detail: "LD-SYN · Programme" }] }, { collapsed: true, mobileOpen: true, profileOpen: true });
  assert.match(ready, /Maroc Ynov Campus/);
  assert.match(ready, /aria-current="page"/);
  assert.match(ready, /Lead Synthétique/);
  assert.match(ready, /\/leads\/lead%2Fid/);
  assert.match(ready, /Administration/);
  assert.match(ready, /scrim/);
  assert.match(ready, /Contenu connecté/);

  const states: Array<[SearchState, string]> = [
    [{ kind: "loading", items: [] }, "Recherche en cours"],
    [{ kind: "empty", items: [] }, "Aucun lead ne correspond"],
    [{ kind: "session", items: [] }, "Session expirée"],
    [{ kind: "forbidden", items: [] }, "Accès interdit"],
    [{ kind: "error", items: [] }, "API locale momentanément indisponible"],
  ];
  for (const [state, copy] of states) assert.match(renderShell(state), new RegExp(copy));

  assert.doesNotMatch(renderShell({ kind: "closed", items: [] }), /Résultats de la recherche globale/);
});

test("renders the client shell initial state and bypasses chrome on authentication routes", () => {
  const authenticated = renderToStaticMarkup(createElement(AppShellClient, { pathname: "/leads", children: createElement("main", null, "Contenu CRM") }));
  assert.match(authenticated, /Navigation CRM/);
  assert.match(authenticated, /Contenu CRM/);

  const authentication = renderToStaticMarkup(createElement(AppShellClient, { pathname: "/", children: createElement("main", null, "Connexion locale") }));
  assert.match(authentication, /^<main>Connexion locale<\/main>$/u);
});
