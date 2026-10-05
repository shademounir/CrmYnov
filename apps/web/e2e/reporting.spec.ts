import { expect, test, type Page } from "@playwright/test";
import type { OwnTelephonySnapshot } from "../app/account/telephony/own-telephony-contract";

const managerTelephony: OwnTelephonySnapshot = {
  global: { enabled: false, mode: "DISABLED" }, profile: null, workstation: null,
  readiness: { available: false, reason: "MODE_DISABLED" }, canPair: false, canRevoke: false,
  localPreferencesOnly: true, inboundEnabled: false, recordingEnabled: false,
};

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
  // Reporting is isolated from the API; include shared shell and Admissions capabilities.
  await page.route("**/api/crm/sessions/current", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ roles: ["MANAGER"], scopes: [{ kind: "CAMPUS", id: "campus-a" }], professionalEmail: "manager@example.invalid", mustChangeSecret: false }) }));
  await page.route("**/api/crm/telephony/me", (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "private, no-store" }, body: JSON.stringify(managerTelephony) });
  });
  await page.route("**/api/crm/admissions/context", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ timezone: "Africa/Casablanca", ownResponsibilities: [], canManageResponsibilities: false, canUseAgenda: true, campuses: [{ id: "campus-a", code: "SYNTHETIC", label: "Campus synthétique" }], eligibleUsers: [] }) }));
  await page.route("**/api/crm/notifications?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], unread: 0, total: 0, page: 1, pageSize: 1 }) }));
  await page.route("**/api/crm/reports/manager-dashboard?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(managerReport) }));
  await page.route("**/api/crm/reports/personal-dashboard?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(personalReport) }));
  await page.route("**/api/crm/leads?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) }));
  await page.route("**/api/crm/lead-views", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/api/crm/view-sharing/received", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/api/crm/view-sharing/audiences", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/api/crm/view-sharing/history", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/reports/manager-dashboard/export?*", (route) => route.fulfill({ status: 200, contentType: "text/csv", headers: { "content-disposition": "attachment; filename=crm-manager-dashboard-v1.csv" }, body: "schemaVersion,timezone,period\nmanager-dashboard-export-v1,Africa/Casablanca,7d\nsection,dimension,value,count\nkpi,uniqueLeads,,3\n" }));
}

test("manager filters, charts, drill-down, return and aggregate export stay coherent", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`${message.text()} @ ${message.location().url || "unknown"}`);
  });
  await page.context().addCookies([{ name: "crm_session", value: "synthetic-manager-session", domain: "localhost", path: "/" }]);
  await mockReporting(page); await page.goto("/manager/reports/dashboard");
  await expect(page.getByRole("link", { name: "Mon agenda Admissions", exact: true })).toHaveAttribute("href", "/appointments/admissions");
  await expect(page.getByRole("link", { name: "Mon poste d’appel", exact: true })).toHaveAttribute("href", "/account/telephony");
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
  await expect(page.locator(".page-canvas main").first()).not.toContainText(/@example|LD-SYNTH|\+212/u);
  expect(consoleErrors).toEqual([]);
});

test("personal scope, empty and error states fail closed", async ({ page }) => {
  await mockReporting(page); await page.goto("/manager/reports/dashboard?view=personal&period=30d"); await expect(page.getByRole("heading", { name: "Mes indicateurs autorisés" })).toBeVisible();
  await expect(page.getByText("Cette vue est limitée au collaborateur connecté")).toBeVisible();
  await page.unroute("**/api/crm/reports/manager-dashboard?*"); await page.route("**/api/crm/reports/manager-dashboard?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...managerReport, cards: { uniqueLeads: 0, enrolled: 0, unassigned: 0, overdueFollowUps: 0, activeAlerts: 0 } }) }));
  await page.goto("/manager/reports/dashboard?period=7d"); await expect(page.getByRole("heading", { name: "Aucun résultat" })).toBeVisible();
  await page.unroute("**/api/crm/reports/manager-dashboard?*"); await page.route("**/api/crm/reports/manager-dashboard?*", (route) => route.fulfill({ status: 403, contentType: "application/json", body: "{}" }));
  await page.goto("/manager/reports/dashboard?period=7d&adviserId=outside-scope"); await expect(page.locator("main section[role=alert]")).toContainText("Accès refusé");
  await expect(page.locator("main section[role=alert]")).not.toContainText("Erreur de chargement");
  await expect(page.locator(".kpi-card")).toHaveCount(0);
  for (const status of [401, 503]) {
    await page.unroute("**/api/crm/reports/manager-dashboard?*");
    await page.route("**/api/crm/reports/manager-dashboard?*", (route) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ detail: "PRIVATE_AUTH_OR_SERVICE_DETAIL" }) }));
    await page.goto("/manager/reports/dashboard?period=7d&campus=campus-a");
    await expect(page.locator("main section[role=alert]")).toContainText(status === 401 ? "Session expirée" : "Erreur de chargement");
    await expect(page.locator("main")).not.toContainText("PRIVATE_AUTH_OR_SERVICE_DETAIL");
    await expect(page.locator(".kpi-card")).toHaveCount(0);
    if (status === 401) {
      await expect(page.getByRole("link", { name: "Se reconnecter", exact: true })).toHaveAttribute("href", "/");
      await expect(page.getByRole("link", { name: "Mon agenda Admissions", exact: true })).toHaveCount(0);
    } else {
      await expect(page.getByRole("link", { name: "Se reconnecter", exact: true })).toHaveCount(0);
    }
  }
});

test("dashboard cards, actions and opened panels stay readable at five widths", async ({ page }) => {
  await mockReporting(page);
  await page.goto("/manager/reports/dashboard?period=7d&campus=campus-a");
  await expect(page.locator(".kpi-card")).toHaveCount(7);
  await page.getByText("Analyses détaillées et tableaux accessibles", { exact: true }).click();
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width <= 768) {
      // The closed sidebar remains visible during its CSS exit transition.
      // Await the actual closed state instead of clicking a transient close control.
      await expect(page.locator("#crm-sidebar")).not.toBeVisible();
      await expect(page.getByRole("button", { name: "Ouvrir la navigation", exact: true })).toHaveAttribute("aria-expanded", "false");
    }
    const overflowing = await page.locator(".kpi-card,.queue-item,.ui-page-header__actions a,.reporting-chart,.reporting-chart > div").evaluateAll((elements) => elements.filter((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.left < -1 || bounds.right > document.documentElement.clientWidth + 1 || element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1;
    }).map((element) => element.textContent));
    expect(overflowing, `Cards, actions and shared charts at ${width}px`).toEqual([]);
    for (const panel of ["filters", "preferences"] as const) {
      const details = page.locator(panel === "filters" ? "details.reporting-filter-popover" : "details.dashboard-preferences");
      await details.locator("summary").click();
      const bounds = await details.locator(panel === "filters" ? "form" : "fieldset").evaluate((element) => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, viewport: document.documentElement.clientWidth }));
      expect(bounds.left, `${panel} left at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(bounds.right, `${panel} right at ${width}px`).toBeLessThanOrEqual(bounds.viewport);
      if (panel === "filters") {
        await page.getByRole("button", { name: "Appliquer", exact: true }).focus();
        await expect(page.getByRole("button", { name: "Appliquer", exact: true })).toBeFocused();
      }
      await details.locator("summary").click();
    }
  }
});

for (const zeroCounts of [false, true]) {
  test(`personal performance remains readable and keyboard-accessible at five widths (${zeroCounts ? "zero" : "nonzero"})`, async ({ page }) => {
    await mockReporting(page);
    await page.route("**/api/crm/sessions/current", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ roles: ["COMMERCIAL"], scopes: [{ kind: "CAMPUS", id: "campus-a" }], professionalEmail: "adviser@example.invalid", mustChangeSecret: false }) }));
    const values = zeroCounts ? [0, 0, 0, 0] : [3, 1, 2, 1];
    const scoped = { ...personalReport,
      performance: { advisers: [{ adviserId: "adviser-synthetic", primaryLeadCount: values[0], secondaryLeadCount: values[1], activeLoad: values[2], followUps: { overdue: values[3] } }] },
      contributions: { contributors: [{ contributorId: "adviser-synthetic", primaryActionCount: zeroCounts ? 0 : 4, secondaryActionCount: zeroCounts ? 0 : 2 }] },
    };
    await page.route("**/api/crm/reports/personal-dashboard?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(scoped) }));
    await page.goto("/manager/reports/dashboard?view=personal&period=30d");
    const performance = page.locator(".dashboard-personal-charts > figure").filter({ has: page.getByRole("heading", { name: "Ma performance", exact: true }) });
    const chart = performance.locator("button.reporting-chart");
    await expect(chart.locator("div > span")).toHaveText(["Leads principaux", "Collaborations", "Charge active", "Relances échues"]);
    await expect(chart.locator("strong")).toHaveText(values.map(String));
    await expect(performance.getByRole("table", { name: "Données alternatives — Ma performance", exact: true })).toBeVisible();
    for (const width of [1440, 1280, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      if (width <= 768) await expect(page.locator("#crm-sidebar")).not.toBeVisible();
      await chart.focus();
      await expect(chart).toBeFocused();
      await expect(page.locator(".kpi-card")).toHaveCount(0);
      const layout = await page.locator(".dashboard-personal-charts").evaluate((element) => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        overflowing: [...element.querySelectorAll("figure,.reporting-chart,.reporting-chart > div,.reporting-chart span,.reporting-chart strong,meter,table")].filter((item) => {
          const bounds = item.getBoundingClientRect();
          return bounds.left < -1 || bounds.right > document.documentElement.clientWidth + 1 || item.scrollWidth > item.clientWidth + 1 || item.scrollHeight > item.clientHeight + 1;
        }).map((item) => item.textContent),
      }));
      expect(layout.documentWidth, `Personal document at ${width}px`).toBeLessThanOrEqual(layout.viewportWidth + 1);
      expect(layout.overflowing, `All personal indicators at ${width}px`).toEqual([]);
      if (width <= 768) {
        expect(await chart.evaluate((element) => getComputedStyle(element).display)).toBe("grid");
        expect((await chart.evaluate((element) => getComputedStyle(element).gridTemplateColumns)).trim().split(/\s+/u)).toHaveLength(2);
      }
    }
  });
}

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
