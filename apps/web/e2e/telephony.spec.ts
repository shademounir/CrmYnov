import { expect, test } from "@playwright/test";

const leadId = "00000000-0000-4000-8000-000000000148";
const call = { id: "synthetic-call", direction: "OUTBOUND", state: "MISSED", maskedPhone: "***123", matchState: "AMBIGUOUS", requestedAt: "2026-09-22T10:00:00Z", recording: { state: "UNAVAILABLE" }, events: [] };

test.beforeEach(async ({ page }) => {
  await page.context().addCookies([{ name: "crm_session", value: "synthetic-telephony-session", domain: "localhost", path: "/" }]);
  // Browser contracts only: no request reaches an API, agent or SIP provider.
  await page.route("**/api/crm/**", async (route) => {
    expect(route.request().method()).toBe("GET");
    const pathname = new URL(route.request().url()).pathname;
    const data = pathname.endsWith("/telephony/provisioning") ? { servers: [], users: [] }
      : pathname.endsWith("/telephony/configuration") ? { mode: "DISABLED", clickToCallEnabled: false, outboundEnabled: false, inboundEnabled: false, version: 1, outboundReadiness: { available: false, reason: "WORKSTATION_NOT_PAIRED" } }
        : pathname.endsWith("/telephony/queue") ? { missed: [call], toVerify: [call] }
          : pathname.endsWith("/leads/" + leadId + "/calls") ? { items: [call] }
            : pathname.endsWith("/users") ? { users: [] } : { items: [], unread: 0 };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
});

test("unpaired workstation cannot activate outbound calling or expose SIP secrets", async ({ page }) => {
  await page.goto("/admin/telephony");
  await expect(page.getByRole("heading", { name: "Postes d’appel Liblinphone" })).toBeVisible();
  await expect(page.getByText("Poste non associé", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Activer les appels sortants" })).toBeDisabled();
  await expect(page.getByText("La réception et l’enregistrement audio demeurent désactivés.", { exact: false })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/token=|\+212/u);
});

test("lead call history displays masked observed metadata without creating a call", async ({ page }) => {
  await page.goto("/leads/" + leadId + "/calls");
  await expect(page.getByRole("heading", { name: "Historique des appels", exact: true })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("Déclenchement désactivé");
  await expect(page.getByRole("heading", { name: "***123 · Manqué", exact: true })).toBeVisible();
  await expect(page.getByText("Aucun audio", { exact: true })).toBeVisible();
  await expect(page.getByText("Non disponible", { exact: true })).toBeVisible();
  await page.getByText("Chronologie immuable (0)").click();
  await expect(page.getByRole("button", { name: "Appeler", exact: true })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/token=|\+212/u);
});

test("missed and ambiguous tabs require an explicit human association", async ({ page }) => {
  await page.goto("/calls/queue");
  await expect(page.getByRole("tab", { name: /Appels manqués/u })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "***123", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /À vérifier/u }).click();
  await expect(page.getByRole("tab", { name: /À vérifier/u })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Plusieurs correspondances", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rapprocher" })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("Aucun appel, webhook ou enregistrement audio réel");
});
