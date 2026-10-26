import { expect, test, type Page } from "@playwright/test";

const leadId = "00000000-0000-4000-8000-000000000148";
const call = { id: "synthetic-call", direction: "OUTBOUND", state: "MISSED", maskedPhone: "***123", matchState: "AMBIGUOUS", requestedAt: "2026-09-22T10:00:00Z", recording: { state: "UNAVAILABLE" }, events: [] };
const noGlobalWorkstation = { scope: "GLOBAL", available: false, reason: "NO_READY_WORKSTATION" };
const readyGlobalWorkstation = { scope: "GLOBAL", available: true, reason: "READY", identityLabel: "Poste Manager synthétique" };
const configuration = (activationReadiness: Record<string, unknown> | null = noGlobalWorkstation): Record<string, unknown> => ({
  mode: "DISABLED", clickToCallEnabled: false, outboundEnabled: false, inboundEnabled: false, recordingPolicy: "DISABLED", version: 1,
  outboundReadiness: { available: false, reason: "WORKSTATION_NOT_PAIRED" },
  ...(activationReadiness === null ? {} : { activationReadiness }),
});

async function configurationResponse(page: Page, value: Record<string, unknown>, status = 200): Promise<void> {
  await page.route("**/api/crm/telephony/configuration", async (route) => {
    expect(route.request().method()).toBe("GET");
    await route.fulfill({ status, json: value });
  });
}

test.beforeEach(async ({ page }) => {
  await page.context().addCookies([{ name: "crm_session", value: "synthetic-telephony-session", domain: "localhost", path: "/" }]);
  // Browser contracts only: no request reaches an API, agent or SIP provider.
  await page.route("**/api/crm/**", async (route) => {
    expect(route.request().method()).toBe("GET");
    const pathname = new URL(route.request().url()).pathname;
    const data = pathname.endsWith("/telephony/provisioning") ? { servers: [], users: [] }
      : pathname.endsWith("/telephony/configuration") ? configuration()
        : pathname.endsWith("/sessions/current") ? { roles: ["SUPER_ADMIN"], scopes: [{ kind: "GLOBAL" }], professionalDisplayName: "Super Admin synthétique", professionalEmail: "admin-synthetic@example.invalid" }
        : pathname.endsWith("/telephony/queue") ? { missed: [call], toVerify: [call] }
          : pathname.endsWith("/leads/" + leadId + "/calls") ? { items: [call] }
            : pathname.endsWith("/users") ? { users: [] } : { items: [], unread: 0 };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
});

test("no eligible global workstation keeps activation disabled without exposing SIP secrets", async ({ page }) => {
  await page.goto("/admin/telephony");
  await expect(page.getByRole("heading", { name: "Postes d’appel Liblinphone" })).toBeVisible();
  await expect(page.getByText("Activation globale du CRM", { exact: true })).toBeVisible();
  await expect(page.getByText("Aucun poste éligible n’est actuellement prêt", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Activer les appels sortants" })).toBeDisabled();
  await expect(page.getByText("La réception et l’enregistrement audio demeurent désactivés.", { exact: false })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/token=|\+212/u);
});

test("caller readiness alone cannot substitute for a missing global activation inventory", async ({ page }) => {
  await configurationResponse(page, { ...configuration(null), outboundReadiness: { available: true, reason: "READY" } });
  await page.goto("/admin/telephony");
  await expect(page.getByText("La disponibilité globale doit être confirmée par le serveur", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Activer les appels sortants" })).toBeDisabled();
});

test("exhausted global inventory remains a visible refusal rather than an activation", async ({ page }) => {
  await configurationResponse(page, configuration({ scope: "GLOBAL", available: false, reason: "ACTIVATION_INVENTORY_LIMIT" }));
  await page.goto("/admin/telephony");
  await expect(page.getByText("La vérification des postes a atteint sa limite", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Activer les appels sortants" })).toBeDisabled();
});

for (const status of [403, 503]) {
  test(`server ${status} after a ready observation disables stale activation without a write`, async ({ page }) => {
    await configurationResponse(page, configuration(readyGlobalWorkstation));
    await page.goto("/admin/telephony");
    await expect(page.getByRole("button", { name: "Activer les appels sortants" })).toBeEnabled();
    await configurationResponse(page, { code: status === 403 ? "telephony_administration_forbidden" : "api_proxy_unavailable" }, status);
    await page.getByRole("button", { name: "Actualiser", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: /configuration|réservée|indisponible|impossible/u })).toBeVisible();
    await expect(page.getByRole("button", { name: "Activer les appels sortants" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Émission activée", exact: true })).toHaveCount(0);
  });
}

// Real browser rendering in the ordinary CI job, with synthetic read-only API
// responses. These screenshots do not qualify an actual agent, SIP or PROD state.
for (const ready of [false, true]) {
  for (const width of [1440, 1280, 1024, 768, 390]) {
    test(`global activation ${ready ? "ready" : "unavailable"} is bounded and keyboard-readable at ${width}px`, async ({ page }, testInfo) => {
      const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
      await configurationResponse(page, configuration(ready ? readyGlobalWorkstation : noGlobalWorkstation));
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/admin/telephony");
      await expect(page.getByRole("heading", { name: ready ? "Poste éligible prêt pour l’activation" : "Activation contrôlée", exact: true })).toBeVisible();
      const activate = page.getByRole("button", { name: "Activer les appels sortants", exact: true });
      if (ready) {
        await expect(activate).toBeEnabled();
        await expect(page.getByText("Poste vérifié : Poste Manager synthétique", { exact: true })).toBeVisible();
        await activate.focus(); await expect(activate).toBeFocused();
      } else {
        await expect(activate).toBeDisabled();
        const refresh = page.getByRole("button", { name: "Actualiser", exact: true });
        await refresh.focus(); await expect(refresh).toBeFocused();
      }
      await expect(page.locator('input[type="password"]')).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText(/token=|\+212/u);
      await expect(page.getByText("Aucun droit individuel supplémentaire n’est accordé.", { exact: false })).toBeVisible();
      await page.evaluate(async () => { await document.fonts.ready; });
      expect(await page.locator(".telephony-admin").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      const outside = await page.locator(".telephony-admin :is(input,button,select)").evaluateAll((elements) => elements.filter((element) => {
        const rect = element.getBoundingClientRect(); return rect.left < -1 || rect.right > innerWidth + 1 || rect.width < 1;
      }).map((element) => element.getAttribute("aria-label") ?? element.textContent));
      expect(outside).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`telephony-global-${ready ? "ready" : "unavailable"}-${width}px.png`), fullPage: true, animations: "disabled" });
      expect(errors).toEqual([]);
    });
  }
}

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
