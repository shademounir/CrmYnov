import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AppShellClient,
  AppShellView,
  isActive,
  loadShellSession,
  loadSearchResults,
  loadUnreadNotificationCount,
  searchItems,
  visibleNavigation,
  ownTelephonyRoleAllowed,
  loadOwnTelephonyAccess,
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
    sessionRoles: ["SUPER_ADMIN"],
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
  assert.equal(isActive("/leads", "/leads", "view=FOLLOW_UP"), false);
  assert.equal(isActive("/leads", "/leads?view=FOLLOW_UP", "view=FOLLOW_UP"), true);
  assert.equal(isActive("/leads", "/leads?view=FOLLOW_UP", "view=MINE"), false);
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

test("limits the shell navigation to the authenticated role without granting API access", async () => {
  const hrefs = (roles: Parameters<typeof visibleNavigation>[0]): string[] => visibleNavigation(roles).map((item) => item.href);
  assert.ok(hrefs(["SUPER_ADMIN"]).includes("/admin/users"));
  assert.ok(!hrefs(["ADMIN"]).includes("/admin/users"));
  assert.ok(hrefs(["MANAGER"]).includes("/imports/wizard"));
  assert.ok(!hrefs(["MANAGER"]).includes("/admin/users"));
  assert.ok(hrefs(["ADMISSIONS"]).includes("/leads"));
  assert.ok(hrefs(["ADMISSIONS"]).includes("/manager/reports/dashboard?view=personal"));
  assert.ok(hrefs(["ADMISSIONS"]).includes("/manager/reports/commercial-performance"));
  assert.ok(!hrefs(["ADMISSIONS"]).includes("/manager/reports/commercial-funnel"));
  assert.ok(!hrefs(["ADMISSIONS"]).includes("/imports/wizard"));
  assert.ok(hrefs(["AUDITOR"]).includes("/admin/audit"));
  assert.ok(!hrefs([]).includes("/leads"));
  const commercial = renderShell({ kind: "closed", items: [] }, { sessionRoles: ["ADMISSIONS"] });
  assert.doesNotMatch(commercial, /href="\/admin\/users"/u);
  assert.match(commercial, /href="\/leads"/u);
  assert.match(commercial, /Commercial/u);
  assert.doesNotMatch(commercial, /Session locale/u);
  assert.deepEqual(await loadShellSession((() => Promise.resolve(response(200, { roles: ["ADMISSIONS", "FORGED"], scopes: [{ kind: "CAMPUS", id: "synthetic" }], professionalEmail: "synthetic@example.invalid" })))), { roles: ["ADMISSIONS"], professionalEmail: "synthetic@example.invalid", scopeLabel: "Campus attribué" });
  assert.deepEqual(await loadShellSession((() => Promise.resolve(response(401)))), { roles: [] });
});

test("loads every bounded global-search state", async () => {
  const signal = new AbortController().signal;
  const ready = await loadSearchResults("lead", signal, (() => Promise.resolve(response(200, { items: [{ id: "lead-1", firstName: "Lead" }] }))));
  assert.equal(ready.kind, "ready");
  assert.equal(await loadSearchResults("none", signal, (() => Promise.resolve(response(200, { items: [] })))).then((value) => value.kind), "empty");
  assert.equal(await loadSearchResults("lead", signal, (() => Promise.resolve(response(401)))).then((value) => value.kind), "session");
  assert.equal(await loadSearchResults("lead", signal, (() => Promise.resolve(response(403)))).then((value) => value.kind), "forbidden");
  assert.equal(await loadSearchResults("lead", signal, (() => Promise.resolve(response(503)))).then((value) => value.kind), "error");
});

test("uses the API unread count instead of a static badge", async () => {
  assert.equal(await loadUnreadNotificationCount((() => Promise.resolve(response(200, { unread: 3 })))), 3);
  assert.equal(await loadUnreadNotificationCount((() => Promise.resolve(response(200, { unread: -2 })))), 0);
  assert.equal(await loadUnreadNotificationCount((() => Promise.resolve(response(401)))), undefined);
  const withBadge = renderShell({ kind: "closed", items: [] }, { unreadNotifications: 3 });
  assert.match(withBadge, /3 non lues/);
  assert.match(withBadge, /notification-dot/);
  assert.doesNotMatch(renderShell({ kind: "closed", items: [] }, { unreadNotifications: 0 }), /notification-dot/);
});

test("renders the responsive shell and every explicit search state", () => {
  const ready = renderShell({ kind: "ready", items: [{ id: "lead/id", label: "Lead Synthétique", detail: "LD-SYN · Programme" }] }, { collapsed: true, mobileOpen: true, profileOpen: true, sessionRoles: ["SUPER_ADMIN"] });
  assert.match(ready, /Maroc Ynov Campus/);
  assert.match(ready, /aria-current="page"/);
  assert.match(ready, /Lead Synthétique/);
  assert.match(ready, /\/leads\/lead%2Fid/);
  assert.match(ready, /Administration/);
  assert.match(ready, /scrim/);
  assert.match(ready, /aria-controls="crm-sidebar" aria-expanded="true"/);
  assert.match(ready, /Contenu connecté/);

  const states: Array<[SearchState, string]> = [
    [{ kind: "loading", items: [] }, "Recherche en cours"],
    [{ kind: "empty", items: [] }, "Aucun lead ne correspond"],
    [{ kind: "session", items: [] }, "Session expirée"],
    [{ kind: "forbidden", items: [] }, "Accès interdit"],
    [{ kind: "error", items: [] }, "Service CRM momentanément indisponible"],
  ];
  for (const [state, copy] of states) assert.match(renderShell(state), new RegExp(copy));

  const closed = renderShell({ kind: "closed", items: [] });
  assert.match(closed, /aria-controls="crm-sidebar" aria-expanded="false"/);
  assert.doesNotMatch(closed, /Résultats de la recherche globale/);
});

test("commercial navigation excludes administration and imports without replacing API permissions", () => {
  const links = visibleNavigation(["ADMISSIONS"]).map((item) => item.href);
  assert.ok(links.includes("/leads"));
  assert.ok(links.includes("/appointments"));
  assert.ok(links.every((href) => !href.startsWith("/admin/")));
  assert.ok(!links.includes("/imports/wizard"));
  const shell = renderShell({ kind: "closed", items: [] }, { sessionRoles: ["ADMISSIONS"], profileOpen: true });
  assert.doesNotMatch(shell, /href="\/admin\//);
});

test("marks only Relances active for the follow-up queue", () => {
  const followUp = renderShell({ kind: "closed", items: [] }, {
    pathname: "/leads",
    locationSearch: "view=FOLLOW_UP",
    sessionRoles: ["ADMISSIONS"],
  });
  assert.match(followUp, /class="active" aria-current="page" href="\/leads\?view=FOLLOW_UP"/u);
  assert.match(followUp, /Page actuelle : Relances/u);
  assert.doesNotMatch(followUp, /href="\/leads" class="active"/u);
  assert.equal((followUp.match(/aria-current="page"/gu) ?? []).length, 1);
});

test("renders the client shell initial state and bypasses chrome on authentication routes", () => {
  const authenticated = renderToStaticMarkup(createElement(AppShellClient, { pathname: "/leads", children: createElement("main", null, "Contenu CRM") }));
  assert.match(authenticated, /Navigation CRM/);
  assert.match(authenticated, /Contenu CRM/);

  const authentication = renderToStaticMarkup(createElement(AppShellClient, { pathname: "/", children: createElement("main", null, "Connexion locale") }));
  assert.match(authentication, /^<main>Connexion locale<\/main>$/u);
});

test("own telephony navigation requires both an eligible role and successful server permission verification", async () => {
  for (const role of ["ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN"] as const) {
    assert.equal(ownTelephonyRoleAllowed([role]), true);
    const allowed = renderShell({ kind: "closed", items: [] }, { pathname: "/account/telephony", profileOpen: true, sessionRoles: [role], ownTelephonyAllowed: true });
    assert.match(allowed, /href="\/account\/telephony"/u);
    assert.match(allowed, /Mon compte · Téléphonie/u);
    assert.match(allowed, /Page actuelle : Mon poste d’appel/u);
    const denied = renderShell({ kind: "closed", items: [] }, { profileOpen: true, sessionRoles: [role], ownTelephonyAllowed: false });
    assert.doesNotMatch(denied, /href="\/account\/telephony"/u);
  }
  assert.equal(ownTelephonyRoleAllowed(["AUDITOR"]), false);
  assert.equal(ownTelephonyRoleAllowed([]), false);
  assert.doesNotMatch(renderShell({ kind: "closed", items: [] }, { profileOpen: true, sessionRoles: ["AUDITOR"], ownTelephonyAllowed: true }), /href="\/account\/telephony"/u);
  for (const status of [200, 401, 403, 503]) assert.equal(await loadOwnTelephonyAccess((input, init) => {
    assert.equal(input, "/api/crm/telephony/me"); assert.equal(init?.cache, "no-store"); return Promise.resolve(response(status));
  }), status === 200);
  assert.equal(await loadOwnTelephonyAccess(() => Promise.reject(new Error("unavailable"))), false);
});
