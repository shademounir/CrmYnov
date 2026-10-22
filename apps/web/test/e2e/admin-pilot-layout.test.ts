import { expect, test } from "@playwright/test";

const campusId = "00000000-0000-4000-8000-000000000471";
const adviserId = "00000000-0000-4000-8000-000000000472";
const ruleId = "00000000-0000-4000-8000-000000000473";
const campus = { id: campusId, code: "SYNTHETIC", label: "Campus synthétique", kind: "CAMPUS", scope: "GLOBAL", campusId: null, state: "ACTIVE", version: 1 };

test("pool and campaign forms use available width at all five pilot viewports", async ({ page }, info) => {
  const errors: string[] = [], writes: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/crm/**", route => {
    if (!["GET", "HEAD"].includes(route.request().method())) writes.push(route.request().url());
    return route.fulfill({ json: { items: [] } });
  });
  await page.route("**/api/crm/references?*", route => {
    const kind = new URL(route.request().url()).searchParams.get("kind");
    return route.fulfill({ json: { items: kind === "CAMPUS" ? [campus] : [] } });
  });
  await page.route("**/api/crm/assignment/config?*", route => route.fulfill({ json: { campusId, version: 1, automaticEnabled: true, rules: [{ id: ruleId, scope: "GLOBAL", strategy: "CONTROLLED_RANDOM", balanceNewEntrants: true, enabled: true, candidates: [{ userId: adviserId, active: true, capacity: 20, activeLeadCount: 0 }] }] } }));
  await page.route("**/api/crm/assignment/pool-administration?*", route => route.fulfill({ json: { campusId, version: 1, fairnessScope: "CAMPUS_CONFIGURATION_VERSION_RULE_NEW_ENTRANTS", candidates: [{ id: adviserId, label: "Conseillère synthétique au nom long", activeLeadCount: 0 }], counters: [] } }));
  await page.goto("/admin/assignment/pools");
  await page.getByRole("combobox", { name: "Campus autorisé", exact: true }).selectOption("SYNTHETIC");
  await expect(page.getByText("Conseillère synthétique au nom long", { exact: true })).toBeVisible();
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const metrics = await page.locator(".pool-admin").evaluate(element => {
      const form = element.querySelector("form")!, member = element.querySelector(".pool-admin__member > div")!;
      return { viewport: window.innerWidth, overflow: document.documentElement.scrollWidth > window.innerWidth, form: form.getBoundingClientRect().width, container: element.getBoundingClientRect().width, identity: member.getBoundingClientRect().width };
    });
    expect(metrics.viewport).toBe(width); expect(metrics.overflow).toBe(false);
    expect(metrics.form).toBeGreaterThan(metrics.container - 2);
    if (width >= 1024) expect(metrics.identity).toBeGreaterThan(150);
    await expect(page.getByRole("button", { name: "Enregistrer les pools et le routage", exact: true })).toBeDisabled();
    await page.screenshot({ path: info.outputPath(`pool-${width}.png`), fullPage: true });
  }
  // Navigate without a full reload: retained route CSS must not re-shrink forms.
  await page.getByRole("link", { name: "Campus et campagnes", exact: true }).click();
  await page.getByRole("combobox", { name: "Référentiel", exact: true }).selectOption("CAMPAIGN");
  await expect(page.getByRole("combobox", { name: "Portée", exact: true })).toHaveValue("CAMPUS");
  await expect(page.getByRole("combobox", { name: "Campus · obligatoire", exact: true })).toHaveValue("");
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const metrics = await page.locator(".reference-admin > form").evaluate(element => ({ viewport: window.innerWidth, overflow: document.documentElement.scrollWidth > window.innerWidth, form: element.getBoundingClientRect().width, maxWidth: getComputedStyle(element).maxWidth }));
    expect(metrics.viewport).toBe(width); expect(metrics.overflow).toBe(false); expect(metrics.maxWidth).toBe("none");
    if (width >= 1024) expect(metrics.form).toBeGreaterThan(512);
    await page.screenshot({ path: info.outputPath(`campaign-${width}.png`), fullPage: true });
  }
  expect(writes).toEqual([]); expect(errors).toEqual([]);
});
