import { expect, test, type Page } from "@playwright/test";

const managerReport = {
  definitionVersion: "manager-dashboard-v1", timezone: "Africa/Casablanca", filters: { period: "7d", campus: "campus-a" },
  cards: { uniqueLeads: 3, enrolled: 1, unassigned: 1, overdueFollowUps: 1, activeAlerts: 1 },
  trends: [{ date: "2026-08-24", leadsCreated: 3, leadsEnrolled: 1 }],
  distributions: { source: [{ value: "SYNTHETIC", count: 3 }], campaign: [{ value: "CAMPAIGN_SYNTHETIC", count: 3 }], program: [{ value: "PROGRAM_SYNTHETIC", count: 3 }], campus: [{ value: "campus-a", count: 3 }] },
  panels: { funnel: { currentState: { PROSPECT: 1, CONTACTED: 1, QUALIFIED: 0, ENROLLED: 1, CLOSED_LOST: 0 } },
    performance: { advisers: [{ adviserId: "adviser-synthetic", activeLoad: 2, primaryLeadCount: 3, secondaryLeadCount: 1 }] },
    operationalRisks: { alerts: [{ code: "follow_up_overdue", count: 1, drillDown: "/leads?view=FOLLOW_UP" }], queues: { overdueFollowUps: 1 } },
    sharedContributions: { contributors: [{ contributorId: "adviser-synthetic", primaryActionCount: 2, secondaryActionCount: 1 }] } },
  drillDowns: [{ key: "uniqueLeads", count: 3, href: "/leads?campus=campus-a&returnTo=%2Fmanager%2Freports%2Fdashboard%3Fperiod%3D7d%26campus%3Dcampus-a" }],
  export: { href: "/reports/manager-dashboard/export?period=7d&campus=campus-a", schemaVersion: "manager-dashboard-export-v1", aggregatedOnly: true },
};
const personalReport = { definitionVersion: "personal-dashboard-v1", timezone: "Africa/Casablanca", filters: { view: "personal" },
  performance: { advisers: [{ adviserId: "adviser-synthetic", activeLoad: 2, primaryLeadCount: 3, secondaryLeadCount: 1, followUps: { overdue: 1 } }] },
  contributions: { contributors: [{ contributorId: "adviser-synthetic", primaryActionCount: 4, secondaryActionCount: 2 }] }, safeguards: { personalScopeOnly: true, aggregatedOnly: true } };

async function mockReporting(page: Page): Promise<void> {
  await page.route("**/api/crm/reports/manager-dashboard?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(managerReport) }));
  await page.route("**/api/crm/reports/personal-dashboard?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(personalReport) }));
  await page.route("**/reports/manager-dashboard/export?*", (route) => route.fulfill({ status: 200, contentType: "text/csv", headers: { "content-disposition": "attachment; filename=crm-manager-dashboard-v1.csv" }, body: "schemaVersion,timezone,period\nmanager-dashboard-export-v1,Africa/Casablanca,7d\nsection,dimension,value,count\nkpi,uniqueLeads,,3\n" }));
}

test("manager filters, charts, drill-down, return and aggregate export stay coherent", async ({ page }) => {
  await page.context().addCookies([{ name: "crm_session", value: "synthetic-manager-session", domain: "localhost", path: "/" }]);
  await mockReporting(page); await page.goto("/manager/reports/dashboard");
  expect((await page.context().cookies()).some((cookie) => cookie.name === "crm_session")).toBe(true);
  await page.locator("details.reporting-filter-popover > summary").click();
  await page.locator('select[name="period"]').selectOption("7d");
  await page.locator('input[name="campus"]').fill("campus-a");
  await page.locator('input[name="source"]').fill("SYNTHETIC");
  await page.getByRole("button", { name: "Appliquer" }).click(); await expect(page).toHaveURL(/period=7d.*campus=campus-a.*source=SYNTHETIC/u);
  await page.getByText("Analyses détaillées et tableaux accessibles", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Indicateurs clés" })).toBeVisible(); await expect(page.getByRole("link", { name: /Leads uniques.*3/u })).toBeVisible();
  const funnel = page.getByRole("button", { name: /Funnel commercial/u }); await funnel.focus(); await expect(funnel).toBeFocused();
  await expect(page.getByRole("table", { name: /Données alternatives — Funnel commercial/u })).toBeVisible();
  await page.getByRole("link", { name: /Leads uniques.*3/u }).click(); await expect(page).toHaveURL(/\/leads\?campus=campus-a.*returnTo=/u);
  await page.getByRole("link", { name: "Retour au dashboard avec les filtres conservés" }).click(); await expect(page).toHaveURL(/period=7d.*campus=campus-a/u);
  await page.getByText("Analyses détaillées et tableaux accessibles", { exact: true }).click();
  const downloadPromise = page.waitForEvent("download"); await page.getByRole("link", { name: "Exporter les agrégats CSV" }).click(); const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("crm-manager-dashboard-v1.csv");
  await expect(page.locator("body")).not.toContainText(/@example|LD-SYNTH|\+212/u);
});

test("personal scope, empty and error states fail closed", async ({ page }) => {
  await mockReporting(page); await page.goto("/manager/reports/dashboard?view=personal&period=30d"); await expect(page.getByRole("heading", { name: "Mes indicateurs autorisés" })).toBeVisible();
  await expect(page.getByText("Cette vue est limitée au collaborateur connecté")).toBeVisible();
  await page.unroute("**/api/crm/reports/manager-dashboard?*"); await page.route("**/api/crm/reports/manager-dashboard?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...managerReport, cards: { uniqueLeads: 0, enrolled: 0, unassigned: 0, overdueFollowUps: 0, activeAlerts: 0 } }) }));
  await page.goto("/manager/reports/dashboard?period=7d"); await expect(page.getByRole("heading", { name: "Aucun résultat" })).toBeVisible();
  await page.unroute("**/api/crm/reports/manager-dashboard?*"); await page.route("**/api/crm/reports/manager-dashboard?*", (route) => route.fulfill({ status: 403, contentType: "application/json", body: "{}" }));
  await page.goto("/manager/reports/dashboard?period=7d&adviserId=outside-scope"); await expect(page.locator("main section[role=alert]")).toContainText("Erreur de chargement");
});

test("hostile labels remain inert and external destinations are refused", async ({ page }) => {
  const hostile = `<img src=x onerror=alert(1)><script>window.__unsafe = true</script>`;
  const hostileReport = {
    ...managerReport,
    distributions: { ...managerReport.distributions, source: [{ value: hostile, count: 1 }] },
    drillDowns: [{ key: "uniqueLeads", count: 1, href: "javascript:alert(1)" }],
    export: { ...managerReport.export, href: "https://external.invalid/export" },
  };
  await page.route("**/api/crm/reports/manager-dashboard?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(hostileReport) }));
  await page.goto("/manager/reports/dashboard?period=7d");
  await page.getByText("Analyses détaillées et tableaux accessibles", { exact: true }).click();
  await expect(page.getByText(hostile, { exact: true }).first()).toBeVisible();
  expect((await page.locator("script").allTextContents()).every((content) => !content.includes("window.__unsafe"))).toBe(true);
  expect(await page.evaluate(() => (window as typeof window & { __unsafe?: boolean }).__unsafe)).toBeUndefined();
  await expect(page.getByRole("link", { name: /Leads uniques/u })).toHaveAttribute("href", "#");
  await expect(page.getByRole("link", { name: "Exporter les agrégats CSV" })).toHaveAttribute("href", "#");
});
