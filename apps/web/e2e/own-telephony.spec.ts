import { expect, test } from "@playwright/test";

type SidebarMetrics = Readonly<{
  width: number; left: number; right: number; cssWidth: string; backgroundImage: string;
  transform: string; visibility: string; gridTemplateColumns: string; shellDisplay: string;
  runningAnimations: number; fonts: string;
}>;

const unpaired = {
  global: { enabled: true, mode: "LINPHONE" }, profile: { id: "profile-synthetic", extension: "synthetic-extension", enabled: true, state: "PAIRING_REQUIRED", version: 1 },
  workstation: null, readiness: { available: false, reason: "WORKSTATION_NOT_PAIRED" }, canPair: true, canRevoke: false,
  localPreferencesOnly: true, inboundEnabled: false, recordingEnabled: false,
};

test("personal workstation page keeps controls accessible at every shell recipe width without launching an agent", async ({ page }, testInfo) => {
  await page.context().addCookies([{ name: "crm_session", value: "synthetic-own-telephony-session", domain: "localhost", path: "/" }]);
  await page.route("**/api/crm/**", async (route) => {
    // Browser-only contracts: no call, pairing, revoke, API runtime or native protocol is executed.
    expect(route.request().method()).toBe("GET");
    const path = new URL(route.request().url()).pathname;
    const dto = path.endsWith("/sessions/current") ? { roles: ["ADMISSIONS"], professionalEmail: "synthetic@example.invalid", scopes: [{ kind: "CAMPUS", id: "synthetic-campus" }] }
      : path.endsWith("/telephony/me") ? unpaired : { items: [], unread: 0 };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dto) });
  });
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 }); await page.goto("/account/telephony");
    await expect(page.getByRole("heading", { name: "Mon poste d’appel", exact: true })).toBeVisible();
    await expect(page.getByText("synthetic-extension", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Adresse CRM à saisir dans l’assistant graphique de l’agent")).toHaveValue(/\/agent\/$/u);
    await expect(page.getByRole("link", { name: "Ouvrir l’agent Windows", exact: true })).toHaveAttribute("href", "crmynov-telephony://open");
    await expect(page.getByRole("button", { name: "Générer mon code d’association", exact: true })).toBeDisabled();
    await expect(page.locator('a[href="/admin/telephony"]')).toHaveCount(0);
    const sidebarMetrics = (): Promise<SidebarMetrics> => page.locator(".sidebar").evaluate((element) => {
      const style = getComputedStyle(element); const box = element.getBoundingClientRect();
      const shell = element.closest(".app-shell")!; const shellStyle = getComputedStyle(shell);
      return {
        width: box.width, left: box.left, right: box.right, cssWidth: style.width,
        backgroundImage: style.backgroundImage, transform: style.transform, visibility: style.visibility,
        gridTemplateColumns: shellStyle.gridTemplateColumns, shellDisplay: shellStyle.display,
        runningAnimations: element.getAnimations().filter((animation) => animation.playState === "running").length,
        fonts: document.fonts.status,
      };
    });
    const initialSidebar = await sidebarMetrics();
    // The shell has width/transform transitions. Capture only settled styles and fonts,
    // while retaining initial metrics to distinguish a real defect from an early frame.
    await page.evaluate(async () => { await document.fonts.ready; });
    const expectedSidebarWidth = width <= 768 ? 300 : width <= 1180 ? 76 : 168;
    await expect.poll(async () => Math.round((await sidebarMetrics()).width)).toBe(expectedSidebarWidth);
    await expect.poll(async () => (await sidebarMetrics()).runningAnimations).toBe(0);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const settledSidebar = await sidebarMetrics();
    expect(settledSidebar.backgroundImage).toContain("linear-gradient");
    expect(settledSidebar.visibility).toBe(width <= 768 ? "hidden" : "visible");
    if (width > 768) { expect(settledSidebar.left).toBe(0); expect(settledSidebar.right).toBe(expectedSidebarWidth); }
    const fits = await page.locator(".own-telephony-page").evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { width: box.width, right: box.right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, viewport: window.innerWidth };
    });
    expect(fits.right).toBeLessThanOrEqual(fits.viewport + 1); expect(fits.scrollWidth).toBeLessThanOrEqual(fits.clientWidth + 1);
    for (const control of await page.locator(".own-telephony :is(button, a, input)").all()) {
      if (!await control.isVisible()) continue;
      const box = await control.boundingBox(); expect(box).not.toBeNull(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    }
    if (width > 1180) await page.screenshot({ path: testInfo.outputPath(`own-telephony-viewport-${width}px.png`), fullPage: false });
    await page.screenshot({ path: testInfo.outputPath(`own-telephony-${width}px.png`), fullPage: true, animations: "disabled" });
    await testInfo.attach(`sidebar-${width}px.json`, { body: Buffer.from(JSON.stringify({ viewport: width, initial: initialSidebar, settled: settledSidebar, afterCapture: await sidebarMetrics() }, null, 2)), contentType: "application/json" });
  }
});

test("revocation cancellation keeps native keyboard focus and does not mutate the workstation", async ({ page }) => {
  await page.context().addCookies([{ name: "crm_session", value: "synthetic-own-telephony-session", domain: "localhost", path: "/" }]);
  await page.route("**/api/crm/**", async (route) => {
    expect(route.request().method()).toBe("GET");
    const path = new URL(route.request().url()).pathname;
    const dto = path.endsWith("/sessions/current") ? { roles: ["MANAGER"], scopes: [{ kind: "CAMPUS", id: "synthetic-campus" }] }
      : path.endsWith("/telephony/me") ? { ...unpaired, canPair: false, canRevoke: true, readiness: { available: true, reason: null }, workstation: { id: "station-synthetic", displayName: "Poste synthétique", active: true, connectionState: "CONNECTED", sdkLoaded: true, sipRegistered: true, agentVersion: "synthetic-pilot", sdkVersion: "synthetic-sdk", lastSeenAt: "2026-10-04T21:00:00Z", pairedAt: "2026-10-04T20:00:00Z", revokedAt: null, version: 3, inputConfigured: true, outputConfigured: true, lastErrorCode: null } }
        : { items: [], unread: 0 };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dto) });
  });
  await page.goto("/account/telephony"); const opener = page.getByRole("button", { name: "Révoquer mon poste", exact: true });
  await opener.click(); await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Conserver mon poste", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0); await expect(opener).toBeFocused();
  await page.getByRole("button", { name: "Ouvrir le menu du compte" }).click();
  await expect(page.getByRole("menuitem", { name: "Mon compte · Téléphonie", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Administration", exact: true })).toHaveCount(0);
});

test("read-only role has no personal telephony entry and a direct forbidden route remains honest", async ({ page }) => {
  await page.context().addCookies([{ name: "crm_session", value: "synthetic-readonly-session", domain: "localhost", path: "/" }]);
  await page.route("**/api/crm/**", async (route) => {
    expect(route.request().method()).toBe("GET"); const path = new URL(route.request().url()).pathname;
    await route.fulfill({ status: path.endsWith("/telephony/me") ? 403 : 200, contentType: "application/json", body: JSON.stringify(path.endsWith("/sessions/current") ? { roles: ["AUDITOR"], scopes: [{ kind: "CAMPUS", id: "synthetic-campus" }] } : { items: [], unread: 0 }) });
  });
  await page.goto("/account/telephony"); await expect(page.getByRole("alert").filter({ hasText: "Vos permissions actuelles" })).toBeVisible();
  await page.getByRole("button", { name: "Ouvrir le menu du compte" }).click();
  await expect(page.getByRole("menuitem", { name: "Mon compte · Téléphonie", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Ouvrir l’agent Windows", exact: true })).toHaveCount(0);
});
