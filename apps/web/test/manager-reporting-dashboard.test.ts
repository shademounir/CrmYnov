import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ManagerReportsDashboardPage from "../app/manager/reports/dashboard/page.js";
import InteractiveReportingDashboard, { preserveFilters, safeInternalHref, type DashboardReport, type PersonalDashboardReport } from "../app/manager/reports/dashboard/reporting-ui.js";
import { containsControlCharacter } from "../app/leads/dashboard-return-link.js";

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
  for (const text of ["Tableau de bord CRM", "Filtres interactifs du reporting", "Africa/Casablanca", "Préférences locales non sensibles", "Chargement", "Réinitialiser"]) assert.equal(html.includes(text), true);
  assert.equal(html.includes("unsafe"), false);
});

test("renders keyboard-focusable charts and an alternative data table for every visualization", () => {
  const html = renderToStaticMarkup(createElement(InteractiveReportingDashboard, { initialFilters: { period: "30d", campus: "campus-a" }, initialReport: report }));
  for (const text of ["Indicateurs clés", "Funnel commercial", "Évolution temporelle", "Répartition par source", "Charge commerciale", "Contributions principales et secondaires", "Données alternatives", "Exporter les agrégats CSV"]) assert.equal(html.includes(text), true);
  assert.equal((html.match(/class="reporting-chart"/gu) ?? []).length, 8); assert.equal((html.match(/type="button"/gu) ?? []).length, 8);
  assert.equal(html.includes("Alex"), false); assert.equal(html.includes("@example"), false); assert.equal(html.includes("returnTo="), true);
});

test("renders the adviser-only personal view without global cards", () => {
  const personal: PersonalDashboardReport = { definitionVersion: "personal-dashboard-v1", timezone: "Africa/Casablanca", filters: { view: "personal" },
    performance: { advisers: [{ adviserId: "adviser-synthetic", activeLoad: 2, primaryLeadCount: 3, secondaryLeadCount: 1, followUps: { overdue: 1 } }] },
    contributions: { contributors: [{ contributorId: "adviser-synthetic", primaryActionCount: 4, secondaryActionCount: 2 }] }, safeguards: { personalScopeOnly: true, aggregatedOnly: true } };
  const html = renderToStaticMarkup(createElement(InteractiveReportingDashboard, { initialFilters: { view: "personal" }, initialReport: personal }));
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
  const html = renderToStaticMarkup(createElement(InteractiveReportingDashboard, { initialFilters: {}, initialReport: hostileReport }));
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
  assert.equal(preserved.includes("assignedToId=adviser-synthetic"), true);
  assert.equal(preserveFilters("javascript:alert(1)", new URLSearchParams()), "#");
});

test("detects ASCII control characters without rejecting international code points", () => {
  assert.equal(containsControlCharacter("/manager/reports/dashboard?campus=équipe-東京"), false);
  assert.equal(containsControlCharacter("/manager/reports/dashboard?campus=unsafe\u0000"), true);
  assert.equal(containsControlCharacter("/manager/reports/dashboard?campus=unsafe\u007f"), true);
});
