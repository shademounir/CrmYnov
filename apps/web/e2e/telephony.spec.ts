import { expect, test } from "@playwright/test";

test("Super Admin sees every code-only mode and the real activation warning", async ({ page }) => {
  await page.goto("/admin/telephony");
  await expect(page.getByRole("heading", { name: "Configuration de la téléphonie" })).toBeVisible();
  for (const mode of ["MANUAL_EXTERNAL", "COOVOX", "LINPHONE", "DISABLED"]) await expect(page.locator("fieldset strong", { hasText: mode })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("Activation réelle gelée");
  await expect(page.locator("body")).not.toContainText(/sip:|token=|password|\+212/u);
});

test("lead call journey remains disabled with accessible reason and metadata only", async ({ page }) => {
  await page.goto("/leads/00000000-0000-4000-8000-000000000148/calls");
  const call = page.getByRole("button", { name: "Appeler" });
  await expect(call).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("Fournisseur réel non configuré");
  await expect(page.getByRole("heading", { name: "Historique append-only" })).toBeVisible();
  await expect(page.getByText(/UNAVAILABLE/u)).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/https?:\/\/|télécharger|\+212/u);
});

test("missed and ambiguous queue never proposes an automatic lead mutation", async ({ page }) => {
  await page.goto("/calls/queue");
  await expect(page.getByRole("link", { name: "Appels manqués" })).toBeVisible();
  await expect(page.getByRole("link", { name: "À vérifier" })).toBeVisible();
  await expect(page.getByText("Aucun lead n’est créé ou réaffecté automatiquement.")).toBeVisible();
  await expect(page.getByRole("table", { name: "File synthétique sans numéro en clair" })).toContainText("***123");
});
