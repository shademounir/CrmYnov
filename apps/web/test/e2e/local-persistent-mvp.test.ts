import { expect, test, type Page } from "@playwright/test";

async function syntheticReference(page: Page, kind: "CAMPUS" | "PROGRAM" | "CAMPAIGN", code: string): Promise<string> {
  // Keep the browser's real cookie policy; do not copy tokens into a request client.
  const response = await page.evaluate(async (data) => {
    const result = await fetch("/api/crm/references", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    const body: unknown = await result.json();
    return { status: result.status, body };
  }, { kind, code, label: `Synthétique ${code}`, scope: "GLOBAL", campusId: null });
  expect(response.status).toBe(201);
  const body = response.body;
  if (!body || typeof body !== "object" || !("id" in body) || typeof body.id !== "string") throw new Error("Synthetic reference response missing id");
  return body.id;
}

test("Product Owner synthetic journey persists from UI to PostgreSQL", async ({ page }) => {
  test.skip(process.env.CRM_LOCAL_E2E !== "true", "Requires the isolated CRMY-157 Docker stack.");
  const password = process.env.CRM_LOCAL_SEED_PASSWORD;
  expect(password?.length).toBeGreaterThanOrEqual(14);
  const suffix = `${Date.now()}`;
  const email = `lead-${suffix}@example.invalid`;

  await page.goto("/");
  await page.getByLabel("Email professionnel").fill("super-admin@example.invalid");
  await page.locator('input[name="password"]').fill(password ?? "");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/leads$/);

  // The identity seed deliberately does not create governed business references.
  // Prepare them through the same authenticated API, without bypassing permissions.
  const campusCode = `SYNTHETIC-${suffix}`;
  const programCode = `PROGRAM-${suffix}`;
  const campaignCode = `CAMPAIGN-${suffix}`;
  const campusId = await syntheticReference(page, "CAMPUS", campusCode);
  const programId = await syntheticReference(page, "PROGRAM", programCode);
  await syntheticReference(page, "CAMPAIGN", campaignCode);
  const availability = await page.evaluate(async ({ programId, campusId }) => {
    const response = await fetch(`/api/crm/references/${programId}/availability/${campusId}`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: true, expectedVersion: 0 }) });
    return response.status;
  }, { programId, campusId });
  expect(availability).toBe(201);

  await page.goto("/leads/new");
  await page.getByLabel("Prénom").fill("Lead");
  await page.getByLabel("Nom", { exact: true }).fill(`Synthétique ${suffix}`);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("combobox", { name: "Campus", exact: true }).selectOption(campusCode);
  await page.getByRole("combobox", { name: "Campagne", exact: true }).selectOption(campaignCode);
  await page.getByLabel("Niveau").fill("BAC");
  await page.getByRole("combobox", { name: "Formation", exact: true }).selectOption(programCode);
  await page.getByLabel("Source").fill("MANUAL");
  await page.getByRole("button", { name: "Créer le lead" }).click();
  await expect(page.getByText("Enregistrement confirmé par l’API.")).toBeVisible();

  await page.goto(`/leads?search=${encodeURIComponent(email)}`);
  await expect(page.getByText(`Synthétique ${suffix}`, { exact: true })).toBeVisible();
  const openHref = await page.locator('a[href^="/leads/"]').filter({ hasText: /^Ouvrir$/ }).first().getAttribute("href");
  expect(openHref).toMatch(/^\/leads\/[0-9a-f-]{36}$/);

  await page.goto(`${openHref ?? ""}/timeline`);
  await expect(page.getByRole("table", { name: "Timeline immuable" })).toContainText("LEAD_CREATED");

  await page.goto("/manager/reports/dashboard");
  await expect(page.getByRole("heading", { name: "Centre d’activité" })).toBeVisible();
});
