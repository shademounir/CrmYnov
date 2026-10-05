import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ManagerReportsDashboardPage from "../app/manager/reports/dashboard/page.js";
import InteractiveReportingDashboard, { preserveFilters, safeInternalHref, type DashboardReport, type PersonalDashboardReport } from "../app/manager/reports/dashboard/reporting-ui.js";
import { containsControlCharacter } from "../app/leads/dashboard-return-link.js";
import { dashboardCalendar } from "../app/manager/reports/dashboard/dashboard-calendar.js";
import { JSDOM } from "jsdom";
import { LeadFilterForm } from "../app/leads/lead-filter-form.js";

const initialCalendar = dashboardCalendar(new Date("2026-10-04T23:53:00.000Z"));

const report: DashboardReport = {
  definitionVersion: "manager-dashboard-v1", timezone: "Africa/Casablanca", filters: { period: "30d", campus: "campus-a" },
  cards: { uniqueLeads: 3, enrolled: 1, unassigned: 1, overdueFollowUps: 1, activeAlerts: 1 },
  trends: [{ date: "2026-08-24", leadsCreated: 3, leadsEnrolled: 1 }],
  distributions: { source: [{ value: "SYNTHETIC", count: 3 }], campaign: [{ value: "CAMPAIGN_SYNTHETIC", count: 3 }], program: [{ value: "PROGRAM_SYNTHETIC", count: 3 }], campus: [{ value: "campus-a", count: 3 }] },
  panels: {
    funnel: { currentState: { PROSPECT: 1, CONTACTED: 1, QUALIFIED: 0, ENROLLED: 1, CLOSED_LOST: 0 } },
    performance: { advisers: [{ adviserId: "adviser-synthetic", activeLoad: 2, primaryLeadCount: 3, secondaryLeadCount: 1 }] },
    operationalRisks: { alerts: [{ code: "follow_up_overdue", count: 1, drillDown: "/leads?view=FOLLOW_UP" }], queues: { overdueFollowUps: 1 } },
    sharedContributions: { contributors: [{ contributorId: "adviser-synthetic", primaryActionCount: 2, secondaryActionCount: 1 }] },
  },
  drillDowns: [{ key: "uniqueLeads", count: 3, href: "/leads?campus=campus-a&returnTo=%2Fmanager%2Freports%2Fdashboard%3Fcampus%3Dcampus-a" }],
  export: { href: "/reports/manager-dashboard/export?campus=campus-a", schemaVersion: "manager-dashboard-export-v1", aggregatedOnly: true },
};

test("renders URL-backed filters and the non-sensitive loading state", async () => {
  const element = await ManagerReportsDashboardPage({ searchParams: Promise.resolve({ period: "7d", campus: "campus-a", ignored: "unsafe" }) });
  const html = renderToStaticMarkup(element);
  for (const text of ["Centre d’activité", "Filtres interactifs du reporting", "Préférences locales non sensibles", "Chargement", "Réinitialiser"]) assert.equal(html.includes(text), true);
  assert.equal(html.includes("unsafe"), false);
});

test("renders keyboard-focusable charts and an alternative data table for every visualization", () => {
  const html = renderToStaticMarkup(createElement(InteractiveReportingDashboard, { initialFilters: { period: "30d", campus: "campus-a" }, initialReport: report, initialCalendar }));
  for (const text of ["Indicateurs clés", "Funnel commercial", "Évolution temporelle", "Répartition par source", "Charge commerciale", "Contributions principales et secondaires", "Données alternatives", "Exporter les agrégats CSV"]) assert.equal(html.includes(text), true);
  assert.equal((html.match(/class="reporting-chart"/gu) ?? []).length, 8); assert.equal((html.match(/type="button"/gu) ?? []).length, 8);
  assert.equal(html.includes("Alex"), false); assert.equal(html.includes("@example"), false); assert.equal(html.includes("returnTo="), true);
});

test("renders the adviser-only personal view without global cards", () => {
  const personal: PersonalDashboardReport = { definitionVersion: "personal-dashboard-v1", timezone: "Africa/Casablanca", filters: { view: "personal" },
    performance: { advisers: [{ adviserId: "adviser-synthetic", activeLoad: 2, primaryLeadCount: 3, secondaryLeadCount: 1, followUps: { overdue: 1 } }] },
    contributions: { contributors: [{ contributorId: "adviser-synthetic", primaryActionCount: 4, secondaryActionCount: 2 }] }, safeguards: { personalScopeOnly: true, aggregatedOnly: true } };
  const html = renderToStaticMarkup(createElement(InteractiveReportingDashboard, { initialFilters: { view: "personal" }, initialReport: personal, initialCalendar }));
  assert.equal(html.includes("Mes indicateurs autorisés"), true); assert.equal(html.includes("Mes contributions"), true); assert.equal(html.includes("Alertes actives"), false);
});

test("keeps hostile aggregate labels as inert text and refuses unsafe destinations", () => {
  const hostile = `<img src=x onerror=alert(1)><script>alert(1)</script>`;
  const hostileReport: DashboardReport = {
    ...report,
    distributions: { ...report.distributions, source: [{ value: hostile, count: 1 }] },
    drillDowns: [{ key: "uniqueLeads", count: 1, href: "javascript:alert(1)" }],
    export: { ...report.export, href: "https://external.invalid/export" },
  };
  const html = renderToStaticMarkup(createElement(InteractiveReportingDashboard, { initialFilters: {}, initialReport: hostileReport, initialCalendar }));
  assert.equal(html.includes("<script>alert(1)</script>"), false);
  assert.equal(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), true);
  assert.equal(html.includes("onerror="), true);
  assert.equal((html.match(/href="#"/gu) ?? []).length >= 2, true);
  assert.equal(html.includes("javascript:"), false);
  assert.equal(html.includes("external.invalid"), false);
});

test("allows only explicit internal reporting destinations", () => {
  for (const href of ["/leads?campus=campus-a", "/reports/manager-dashboard/export?period=7d"]) assert.equal(safeInternalHref(href), href);
  for (const href of ["javascript:alert(1)", "jAvAsCrIpT%3Aalert(1)", "https://external.invalid", "//external.invalid", "/../secret", "/admin", "/leads\\..\\secret", "/leads\0unsafe"]) assert.equal(safeInternalHref(href), "#");
  const preserved = preserveFilters("/leads?view=FOLLOW_UP", new URLSearchParams({ from: "2026-08-01", to: "2026-08-24", adviserId: "adviser-synthetic", campus: "campus-a" }));
  assert.equal(preserved.startsWith("/leads?"), true);
  assert.equal(preserved.includes("createdFrom=2026-08-01"), true);
  assert.equal(preserved.includes("adviserId=adviser-synthetic"), true);
  assert.equal(preserved.includes("createdBefore=2026-08-24"), true);
  assert.equal(preserved.includes("createdTo="), false);
  assert.equal(preserveFilters("javascript:alert(1)", new URLSearchParams()), "#");
});

test("detects ASCII control characters without rejecting international code points", () => {
  assert.equal(containsControlCharacter("/manager/reports/dashboard?campus=équipe-東京"), false);
  assert.equal(containsControlCharacter("/manager/reports/dashboard?campus=unsafe\u0000"), true);
  assert.equal(containsControlCharacter("/manager/reports/dashboard?campus=unsafe\u007f"), true);
});

test("period, preferred period and reset preserve the personal view and selected scope", () => {
  const filters = { view: "personal", period: "custom", campus: "campus-a", source: "SYNTHETIC", campaign: "CAMPAIGN_SYNTHETIC", from: "2026-10-01", to: "2026-10-05" };
  const dom = new JSDOM(renderToStaticMarkup(createElement(InteractiveReportingDashboard, { initialFilters: filters, initialCalendar })));
  const links = [...dom.window.document.querySelectorAll<HTMLAnchorElement>(".period-selector a, .dashboard-preferences a, .reporting-filter-popover a")];
  assert.equal(links.length, 6);
  for (const link of links) {
    const url = new URL(link.getAttribute("href")!, "https://dev.example.invalid");
    assert.equal(url.searchParams.get("view"), "personal");
    assert.equal(url.searchParams.get("campus"), "campus-a");
    assert.equal(url.searchParams.get("source"), "SYNTHETIC");
    assert.equal(url.searchParams.get("campaign"), "CAMPAIGN_SYNTHETIC");
  }
  assert.match(dom.window.document.body.textContent ?? "", /Réinitialiser la période/u);
  assert.doesNotMatch(dom.window.document.body.textContent ?? "", /Ce mois|Ce trimestre/u);
  dom.window.close();
});

test("quick queues retain the selected cohort and show the backend first-interaction count", () => {
  const scoped = { ...report, panels: { ...report.panels, operationalRisks: { ...report.panels.operationalRisks, queues: { withoutFirstInteraction: 2 } } } };
  const filters = { view: "global", period: "custom", campus: "campus-a", source: "SYNTHETIC", from: "2026-10-01T00:00:00.000Z", to: "2026-10-05T00:00:00.000Z" };
  const dom = new JSDOM(renderToStaticMarkup(createElement(InteractiveReportingDashboard, { initialFilters: filters, initialReport: scoped, initialCalendar })));
  for (const link of dom.window.document.querySelectorAll<HTMLAnchorElement>(".quick-queues a")) {
    const url = new URL(link.getAttribute("href")!, "https://dev.example.invalid");
    assert.equal(url.searchParams.get("campus"), "campus-a");
    assert.equal(url.searchParams.get("createdFrom"), filters.from);
    assert.equal(url.searchParams.get("createdBefore"), filters.to);
    assert.equal(url.searchParams.has("createdTo"), false);
    assert.equal(new URL(url.searchParams.get("returnTo")!, "https://dev.example.invalid").searchParams.get("source"), "SYNTHETIC");
  }
  assert.match(dom.window.document.querySelector(".quick-queues")?.textContent ?? "", /Première interaction échue2/u);
  dom.window.close();
});

test("missing or null observations are not displayed as zero or fabricated names", () => {
  const unavailable = { ...report, cards: { ...report.cards, activeAlerts: null }, panels: { ...report.panels, operationalRisks: { ...report.panels.operationalRisks, sourceQualityAvailability: "UNAVAILABLE_NOT_DURABLY_RECONSTRUCTED", queues: {} } } } as unknown as DashboardReport;
  const dom = new JSDOM(renderToStaticMarkup(createElement(InteractiveReportingDashboard, { initialFilters: {}, initialReport: unavailable, initialCalendar })));
  const alerts = [...dom.window.document.querySelectorAll(".kpi-card")].find((item) => item.textContent?.includes("Alertes actives"));
  assert.equal(alerts?.querySelector("strong")?.textContent, "Indisponible");
  assert.match(dom.window.document.querySelector(".quick-queues")?.textContent ?? "", /Non observé/u);
  assert.doesNotMatch(dom.window.document.body.textContent ?? "", /adviser-synthetic/u);
  dom.window.close();
});

test("assignment drill-down is explicit and retains reporting context without widening destinations", () => {
  const context = new URLSearchParams({ period: "7d", campus: "campus-a", source: "SYNTHETIC", view: "personal" });
  const href = preserveFilters("/manager/assignment", context);
  assert.notEqual(href, "#");
  const url = new URL(href, "https://dev.example.invalid");
  assert.equal(url.pathname, "/manager/assignment");
  assert.equal(url.searchParams.get("campus"), "campus-a");
  assert.equal(new URL(url.searchParams.get("returnTo")!, "https://dev.example.invalid").searchParams.get("view"), "personal");
  assert.equal(preserveFilters("/manager/closures", context), "#", "the unavailable legacy closure queue must not be presented as an implemented route");
});

test("the Lead list preserves the readonly adviser cohort and exclusive upper bound when filtering", () => {
  const current = new URLSearchParams({ adviserId: "adviser-synthetic", createdBefore: "2026-10-05T00:00:00.000Z" });
  const dom = new JSDOM(renderToStaticMarkup(createElement(LeadFilterForm, { current, mode: "directory" })));
  const form = dom.window.document.querySelector<HTMLFormElement>("form")!;
  const submitted = new dom.window.FormData(form);
  assert.equal(submitted.get("adviserId"), current.get("adviserId"));
  assert.equal(submitted.get("createdBefore"), current.get("createdBefore"));
  assert.equal(form.querySelector('input[name="adviserId"]')?.getAttribute("type"), "hidden");
  dom.window.close();
});

async function dashboardDom(t: TestContext): Promise<{
  host: HTMLElement;
  render: (props: Parameters<typeof InteractiveReportingDashboard>[0]) => Promise<void>;
  renderElement: (element: ReturnType<typeof createElement>) => Promise<void>;
}> {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://dev.example.invalid/manager/reports/dashboard" });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const host = dom.window.document.getElementById("root")!;
  const root = createRoot(host);
  t.after(async (): Promise<void> => {
    await act<void>(() => root.unmount()); dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  });
  const renderElement = async (element: ReturnType<typeof createElement>): Promise<void> => {
    await act(async () => { root.render(element); await new Promise<void>((resolve) => setImmediate(resolve)); });
  };
  return { host, renderElement, render: (props): Promise<void> => renderElement(createElement(InteractiveReportingDashboard, props)) };
}

function requestPath(input: string | URL | Request): string { return input instanceof Request ? input.url : String(input); }

test("recent Leads use the exact normalized report cohort and observed owner label", async (t) => {
  const view = await dashboardDom(t);
  const requests: Array<{ url: URL; init: RequestInit | undefined }> = [];
  const filters = { view: "personal", period: "30d", campus: "CAMPUS_CANONICAL", adviserId: "adviser-synthetic", from: "2026-09-05T08:00:00.000Z", to: "2026-10-05T08:00:00.000Z", source: "SYNTHETIC" };
  const scoped = { ...report, filters, capabilities: { canCreateLead: false, canReadRecentLeads: true, canViewManagerDashboard: false } };
  t.mock.method(globalThis, "fetch", (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(requestPath(input), "https://dev.example.invalid");
    if (url.pathname.endsWith("/recent-leads")) {
      requests.push({ url, init });
      return Promise.resolve(Response.json({ availability: "OBSERVED", leads: [{ id: "lead-synthetic", leadCode: "LD-SYNTHETIC", name: "<script>inert</script>", status: "QUALIFIED", createdAt: filters.from, assignedToLabel: "Responsable synthétique" }] }));
    }
    return Promise.resolve(Response.json({ canUseAgenda: false }));
  });
  await view.render({ initialFilters: { ...filters, campus: "uuid-before-normalization" }, initialReport: scoped, initialCalendar });
  assert.equal(requests.length, 1);
  const { url, init } = requests[0]!;
  assert.equal(url.pathname, "/api/crm/reports/dashboard/recent-leads");
  for (const key of ["campus", "source", "adviserId", "view", "from", "to"]) assert.equal(url.searchParams.get(key), filters[key as keyof typeof filters]);
  assert.equal(url.searchParams.get("period"), "custom", "freeze the report window instead of recomputing a rolling clock");
  assert.equal(url.searchParams.get("limit"), "5"); assert.equal(init?.credentials, "same-origin");
  assert.match(view.host.querySelector(".leads-panel")?.textContent ?? "", /Responsable synthétique/u);
  assert.equal(view.host.querySelector("script"), null);
  assert.doesNotMatch(view.host.textContent ?? "", /adviser-synthetic/u);
  assert.equal(view.host.querySelector('a[href^="/leads/new"]'), null);
  const globalOption = view.host.querySelector<HTMLOptionElement>('select[name="view"] option[value="global"]');
  assert.equal(globalOption?.disabled, true);
});

test("missing or denied capabilities do not fetch recent Leads or offer creation", async (t) => {
  const view = await dashboardDom(t); const paths: string[] = [];
  t.mock.method(globalThis, "fetch", (input: string | URL | Request): Promise<Response> => {
    paths.push(requestPath(input)); return Promise.resolve(Response.json({ canUseAgenda: false }));
  });
  await view.render({ initialFilters: {}, initialReport: report, initialCalendar });
  assert.equal(paths.some((path) => path.includes("recent-leads")), false);
  assert.equal(view.host.querySelector('a[href^="/leads/new"]'), null);
  assert.match(view.host.querySelector(".leads-panel")?.textContent ?? "", /indisponible.*autorisations/u);
});

for (const scenario of ["empty", "unavailable", "forbidden", "network", "malformed"] as const) {
  test(`recent Lead ${scenario} state is honest and never exposes raw error details`, async (t) => {
    const view = await dashboardDom(t);
    const scoped = { ...report, capabilities: { canCreateLead: true, canReadRecentLeads: true, canViewManagerDashboard: true } };
    t.mock.method(globalThis, "fetch", (input: string | URL | Request): Promise<Response> => {
      if (!requestPath(input).includes("recent-leads")) return Promise.resolve(Response.json({ canUseAgenda: false }));
      if (scenario === "network") return Promise.reject(new Error("PRIVATE_RAW_ERROR"));
      if (scenario === "forbidden") return Promise.resolve(Response.json({ detail: "PRIVATE_RAW_ERROR" }, { status: 403 }));
      if (scenario === "malformed") return Promise.resolve(Response.json({ availability: "OBSERVED", leads: [{ id: "javascript:PRIVATE_RAW_ERROR" }] }));
      return Promise.resolve(Response.json({ availability: scenario === "unavailable" ? "UNAVAILABLE" : "OBSERVED", leads: [] }));
    });
    await view.render({ initialFilters: {}, initialReport: scoped, initialCalendar });
    const content = view.host.querySelector(".leads-panel")?.textContent ?? "";
    if (scenario === "empty") assert.match(content, /Aucun lead récent dans la période et le périmètre autorisés/u);
    else if (scenario === "forbidden") assert.match(content, /Accès.*refusé/u);
    else { assert.match(content, /indisponible/u); assert.doesNotMatch(content, /Aucun lead récent/u); }
    assert.doesNotMatch(view.host.textContent ?? "", /PRIVATE_RAW_ERROR/u);
    assert.ok(view.host.querySelector('a[href^="/leads/new"]'));
  });
}

test("personal reporting fetch stays personal and distinguishes loading, empty and unavailable evidence", async (t) => {
  const view = await dashboardDom(t);
  let release: ((response: Response) => void) | undefined;
  const paths: string[] = [];
  t.mock.method(globalThis, "fetch", (input: string | URL | Request): Promise<Response> => {
    const path = requestPath(input); paths.push(path);
    if (path.includes("personal-dashboard")) return new Promise<Response>((resolve) => { release = resolve; });
    return Promise.resolve(Response.json({ canUseAgenda: false }));
  });
  await view.render({ initialFilters: { view: "personal", source: "SYNTHETIC" }, initialCalendar });
  assert.match(view.host.textContent ?? "", /Calcul des indicateurs/u);
  assert.equal(paths.some((path) => path.includes("manager-dashboard")), false);
  assert.equal(paths.some((path) => path.includes("personal-dashboard") && path.includes("view=personal")), true);
  const { act } = await import("react");
  await act(async () => {
    assert.ok(release);
    release(Response.json({ definitionVersion: "personal-dashboard-v1", timezone: "Africa/Casablanca", filters: { view: "personal" }, performance: { advisers: [] }, contributions: { contributors: [] }, safeguards: { personalScopeOnly: true, aggregatedOnly: true }, persistence: { countsObservability: { appointmentCount: { state: "UNAVAILABLE", reason: "permission_required" } } } }));
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  assert.match(view.host.textContent ?? "", /compteurs.*indisponibles/u);
  assert.doesNotMatch(view.host.textContent ?? "", /Aucune donnée agrégée/u);
  assert.doesNotMatch(view.host.textContent ?? "", /Alertes actives/u);
});

test("the Lead date input keeps its exact instant until an explicit date edit", async (t) => {
  const view = await dashboardDom(t);
  const instant = "2026-10-01T08:14:27.000Z";
  await view.renderElement(createElement(LeadFilterForm, { current: new URLSearchParams({ createdFrom: instant, createdBefore: "2026-10-05T08:00:00.000Z", adviserId: "adviser-synthetic", returnTo: "/manager/reports/dashboard?view=personal", channel: "DIGITAL" }), mode: "directory" }));
  const form = view.host.querySelector<HTMLFormElement>("form")!;
  const window = form.ownerDocument.defaultView!;
  let values = new window.FormData(form);
  assert.deepEqual(values.getAll("createdFrom"), [instant], "never submit both the displayed date and original instant under one name");
  assert.equal(values.get("createdBefore"), "2026-10-05T08:00:00.000Z");
  assert.equal(values.get("returnTo"), "/manager/reports/dashboard?view=personal");
  assert.equal(values.get("channel"), "DIGITAL");
  const input = form.querySelector<HTMLInputElement>('input[type="date"]:not([name])')!;
  assert.equal(input.value, "2026-10-01");
  const setInputValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.bind(input);
  const { act } = await import("react");
  act(() => {
    setInputValue("2026-10-02");
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  values = new window.FormData(form);
  assert.deepEqual(values.getAll("createdFrom"), ["2026-10-02"], "use legacy date-only parsing only after the user explicitly edits the date");
});

for (const scenario of ["observed-empty", "failed"] as const) {
  test(`the report ${scenario} state is distinct from an observed zero KPI`, async (t) => {
    const view = await dashboardDom(t);
    t.mock.method(globalThis, "fetch", (input: string | URL | Request): Promise<Response> => {
      if (!requestPath(input).includes("personal-dashboard")) return Promise.resolve(Response.json({ canUseAgenda: false }));
      if (scenario === "failed") return Promise.reject(new Error("PRIVATE_RAW_ERROR"));
      return Promise.resolve(Response.json({ definitionVersion: "personal-dashboard-v1", timezone: "Africa/Casablanca", filters: { view: "personal" }, performance: { advisers: [] }, contributions: { contributors: [] }, safeguards: { personalScopeOnly: true, aggregatedOnly: true } }));
    });
    await view.render({ initialFilters: { view: "personal" }, initialCalendar });
    assert.match(view.host.textContent ?? "", scenario === "failed" ? /Erreur de chargement/u : /Aucune donnée agrégée/u);
    assert.equal(view.host.querySelector(".kpi-card"), null);
    assert.doesNotMatch(view.host.textContent ?? "", /PRIVATE_RAW_ERROR/u);
  });
}
