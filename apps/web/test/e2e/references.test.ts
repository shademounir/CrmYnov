import { expect, test } from "@playwright/test";

test("synthetic governed reference form and tags are responsive and keyboard-accessible", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/api/crm/**", (route) => route.fulfill({ json: { items: [] } }));
  const campus = { id: "00000000-0000-4000-8000-000000000441", code: "SYNTHETIC", label: "Campus synthétique", kind: "CAMPUS", scope: "GLOBAL", campusId: null, state: "ACTIVE", version: 1 };
  const tag = { ...campus, id: "00000000-0000-4000-8000-000000000442", code: "TEST", kind: "TAG", label: "Tag synthétique" };
  await page.route("**/api/crm/references?*", async (route) => { const kind = new URL(route.request().url()).searchParams.get("kind"); await route.fulfill({ json: { items: [kind === "TAG" ? tag : { ...campus, kind, code: kind === "PROGRAM" ? "B1" : "SYNTHETIC" }] } }); });
  await page.route("**/api/crm/leads", async (route) => { expect(route.request().postDataJSON()).toMatchObject({ campus: "SYNTHETIC", program: "B1", campaign: "SYNTHETIC" }); await route.fulfill({ status: 201, json: { lead: { id: "synthetic-lead" } } }); });
  await page.route("**/api/crm/leads/*/tags", async (route) => {
    if (route.request().method() === "PATCH") { expect(route.request().postDataJSON()).toMatchObject({ tagIds: [tag.id], expectedVersion: 1 }); await route.fulfill({ json: { tagIds: [tag.id], version: 2 } }); }
    else await route.fulfill({ json: { items: [], version: 1, canAssign: true } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/leads/new"); await page.getByRole("combobox", { name: "Campus", exact: true }).selectOption("SYNTHETIC");
  await expect(page.getByRole("combobox", { name: "Formation", exact: true })).toBeEnabled(); await page.getByRole("combobox", { name: "Formation", exact: true }).selectOption("B1");
  const select = page.getByRole("combobox", { name: "Formation", exact: true }); await select.focus(); await expect(select).toBeFocused(); expect((await select.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await page.getByRole("combobox", { name: "Campagne", exact: true }).selectOption("SYNTHETIC");
  for (const [label, value] of [["Prénom", "Lead"], ["Nom", "Synthétique"], ["Niveau", "BAC"], ["Source", "TEST"]] as const) await page.getByRole("textbox", { name: label, exact: true }).fill(value);
  await page.getByRole("button", { name: "Créer le lead", exact: true }).click(); await expect(page.getByText("Enregistrement confirmé par l’API.", { exact: true })).toBeVisible();
  await page.goto("/leads/00000000-0000-4000-8000-000000000443/tags");
  await expect(page.getByLabel("Tag synthétique", { exact: true })).toBeEnabled(); await page.getByLabel("Tag synthétique", { exact: true }).check();
  await page.getByRole("button", { name: "Enregistrer les tags", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tags du lead" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("reference administration archives/restores and uses the server availability version", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message)); page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const campus = { id: "00000000-0000-4000-8000-000000000451", code: "SYNTHETIC", label: "Campus synthétique", kind: "CAMPUS", scope: "GLOBAL", campusId: null, state: "ACTIVE", version: 1 };
  let tag = { ...campus, id: "00000000-0000-4000-8000-000000000452", code: "TEST", kind: "TAG", label: "Tag synthétique" };
  await page.route("**/api/crm/**", (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/crm/references?*", async (route) => { const kind = new URL(route.request().url()).searchParams.get("kind"); await route.fulfill({ json: { items: [kind === "TAG" ? tag : { ...campus, kind, id: kind === "PROGRAM" ? "00000000-0000-4000-8000-000000000453" : campus.id }] } }); });
  await page.route(`**/api/crm/references/${tag.id}`, async (route) => { const body = route.request().postDataJSON() as { state: string; expectedVersion: number }; expect(body.expectedVersion).toBe(tag.version); tag = { ...tag, state: body.state, version: tag.version + 1 }; await route.fulfill({ json: tag }); });
  await page.route("**/api/crm/references/*/availability/*", async (route) => { if (route.request().method() === "POST") expect(route.request().postDataJSON()).toEqual({ active: false, expectedVersion: 7 }); await route.fulfill({ json: { active: true, version: 7 } }); });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/admin/references");
  await page.getByRole("button", { name: "Archiver Tag synthétique", exact: true }).click();
  await expect(page.getByRole("button", { name: "Restaurer Tag synthétique", exact: true })).toBeVisible();
  await expect(page.getByText("Modification enregistrée et auditée.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restaurer Tag synthétique", exact: true }).click();
  await expect(page.getByRole("button", { name: "Archiver Tag synthétique", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Référentiel", exact: true }).selectOption("PROGRAM");
  await page.getByRole("combobox", { name: "Disponibilité campus", exact: true }).selectOption(campus.id);
  await expect(page.getByText("Disponibilité actuelle : active · version 7", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Désactiver pour ce campus", exact: true }).click();
  for (const width of [390, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); }
  expect(errors).toEqual([]);
});
