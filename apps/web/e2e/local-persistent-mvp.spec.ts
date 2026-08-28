import { expect, test } from "@playwright/test";

test("Product Owner synthetic journey persists from UI to PostgreSQL", async ({ page }) => {
  test.skip(process.env.CRM_LOCAL_E2E !== "true", "Requires the isolated CRMY-157 Docker stack.");
  const password = process.env.CRM_LOCAL_SEED_PASSWORD;
  expect(password?.length).toBeGreaterThanOrEqual(14);
  const suffix = `${Date.now()}`;
  const email = `lead-${suffix}@example.invalid`;

  await page.goto("/");
  await page.getByLabel("Email professionnel").fill("super-admin@example.invalid");
  await page.getByLabel("Mot de passe").fill(password ?? "");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/leads$/);

  await page.goto("/leads/new");
  await page.getByLabel("Prénom").fill("Lead");
  await page.getByLabel("Nom", { exact: true }).fill(`Synthétique ${suffix}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Campus").fill("SYNTHETIC");
  await page.getByLabel("Campagne").fill("CRMY-157");
  await page.getByLabel("Niveau").fill("BAC");
  await page.getByLabel("Formation").fill("Programme synthétique");
  await page.getByLabel("Source").fill("MANUAL");
  await page.getByRole("button", { name: "Créer le lead" }).click();
  await expect(page.getByText("Enregistrement confirmé par l’API.")).toBeVisible();

  const leadsResponse = await page.request.get(`/api/crm/leads?search=${encodeURIComponent(email)}&page=1&pageSize=25`);
  expect(leadsResponse.ok()).toBeTruthy();
  const leads = await leadsResponse.json() as { items?: Array<{ id?: string; email?: string }> };
  expect(leads.items).toHaveLength(1);
  expect(leads.items?.[0]?.email).toBe(email);
  const leadId = leads.items?.[0]?.id;
  expect(leadId).toMatch(/^[0-9a-f-]{36}$/);

  await page.goto(`/leads/${encodeURIComponent(leadId ?? "")}/timeline`);
  await expect(page.getByRole("table", { name: "Timeline immuable" })).toContainText("LEAD_CREATED");

  await page.goto("/manager/reports/dashboard");
  await expect(page.getByRole("heading", { name: /Tableau de bord|Reporting/ })).toBeVisible();
});
